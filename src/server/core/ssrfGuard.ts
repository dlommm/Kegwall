import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

// ---------------------------------------------------------------------------
// SSRF guard for every place in this codebase where a user-supplied HOST reaches an
// outbound server-side `fetch()` (every OTHER outbound call, e.g. MdashClient, Open
// Brewery DB, targets a fixed/settings-configured base URL, never a caller-supplied one):
//   - `routes/lookup.ts`'s `downloadAndStoreLabel` — a generic remote label download
//     helper, called today by `routes/kegtron.ts`'s Pro import (its decoded device
//     `labelUrl` reaches a server-side fetch against a settings-configured CDN base URL —
//     see `ingest/kegtron/shadow.ts`'s `decodeUntappdLabelUrl`). An admin who can edit
//     that base URL, or a compromised/malicious upstream feeding a crafted host, could
//     otherwise point the download at an internal service or a cloud metadata endpoint
//     (169.254.169.254) and have the SERVER fetch it on their behalf.
//   - Phase 5 Task 3: `automation/engine.ts`'s `webhook` action — its `url` is
//     EDITOR-authored (set when a rule is created/edited, per `core/automationSchema.ts`'s
//     `ActionSchema`), exactly the same "a human with editor role, not the server itself,
//     chooses this host" trust boundary as `labelUrl` above, and exactly the same risk: an
//     automation rule's webhook URL could otherwise be pointed at an internal service or
//     cloud metadata endpoint and have the SERVER hit it on every rule firing.
//
// Kept dependency-free and framework-free (no Fastify/zod imports) so it's directly
// unit-testable without a network or an HTTP server — see tests/core/ssrfGuard.test.ts.
// ---------------------------------------------------------------------------

/** Resolves `hostname` to every address it maps to. Defaults to `node:dns/promises`'
 * `lookup(hostname, {all:true})`; injectable so callers (tests, `lookupRoutes`' own
 * `opts.resolveHost`) can avoid real DNS. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

export class ForbiddenHostError extends Error {}

function isForbiddenIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable — fail closed rather than let a weird literal through
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 0) return true; // 0.0.0.0/8 "this network" / unspecified
  return false;
}

/** Expands a valid IPv6 literal (any legal `::`-compressed or embedded-IPv4-tail form,
 * e.g. `fe80::1`, `::ffff:192.168.1.1`) into its 8 16-bit blocks. Returns `null` for
 * anything that doesn't parse as a well-formed IPv6 address. */
function expandIPv6(ip: string): number[] | null {
  // Strip a zone id (e.g. "fe80::1%eth0") if present — not relevant to range checks.
  const clean = ip.includes('%') ? ip.slice(0, ip.indexOf('%')) : ip;

  const sepIndex = clean.indexOf('::');
  const head = sepIndex === -1 ? clean : clean.slice(0, sepIndex);
  const tail = sepIndex === -1 ? '' : clean.slice(sepIndex + 2);

  function splitBlocks(part: string): string[] {
    return part.length === 0 ? [] : part.split(':');
  }

  // An embedded IPv4 tail (e.g. the "192.168.1.1" in "::ffff:192.168.1.1") occupies the
  // LAST two 16-bit blocks — expand it into two hex blocks so the rest of this function
  // can treat every address uniformly as 8 hex blocks.
  function expandIPv4Tail(parts: string[]): string[] | null {
    if (parts.length === 0) return parts;
    const last = parts[parts.length - 1]!;
    if (!last.includes('.')) return parts;
    const octets = last.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const [o1, o2, o3, o4] = octets as [number, number, number, number];
    const hi = ((o1 << 8) | o2).toString(16);
    const lo = ((o3 << 8) | o4).toString(16);
    return [...parts.slice(0, -1), hi, lo];
  }

  const headParts = expandIPv4Tail(splitBlocks(head));
  const tailParts = expandIPv4Tail(splitBlocks(tail));
  if (headParts === null || tailParts === null) return null;

  const totalGiven = headParts.length + tailParts.length;
  let fullParts: string[];
  if (sepIndex === -1) {
    if (totalGiven !== 8) return null;
    fullParts = headParts;
  } else {
    if (totalGiven > 8) return null;
    fullParts = [...headParts, ...Array(8 - totalGiven).fill('0'), ...tailParts];
  }
  if (fullParts.length !== 8) return null;

  const blocks: number[] = [];
  for (const part of fullParts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    blocks.push(parseInt(part, 16));
  }
  return blocks;
}

function isForbiddenIPv6(ip: string): boolean {
  const blocks = expandIPv6(ip);
  if (!blocks) return true; // unparseable — fail closed

  // IPv4-mapped (::ffff:a.b.c.d): defer to the IPv4 rules for the embedded address.
  if (blocks.slice(0, 4).every((b) => b === 0) && blocks[4] === 0 && blocks[5] === 0xffff) {
    const b6 = blocks[6]!;
    const b7 = blocks[7]!;
    const ipv4 = `${(b6 >> 8) & 0xff}.${b6 & 0xff}.${(b7 >> 8) & 0xff}.${b7 & 0xff}`;
    return isForbiddenIPv4(ipv4);
  }

  if (blocks.every((b) => b === 0)) return true; // :: unspecified
  if (blocks.slice(0, 7).every((b) => b === 0) && blocks[7] === 1) return true; // ::1 loopback
  if ((blocks[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((blocks[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** True when `ip` (a literal IPv4 or IPv6 address, e.g. from a DNS answer or a literal
 * host in a URL) is loopback, private, link-local, unspecified, or IPv6 unique-local —
 * i.e. anything that must never be reachable from this server's own outbound fetch on a
 * caller-supplied URL. Not a general-purpose IP-range library; scoped to exactly the
 * ranges this guard needs to block. */
export function isForbiddenAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isForbiddenIPv4(ip);
  if (version === 6) return isForbiddenIPv6(ip);
  return true; // not a valid IP literal at all — fail closed
}

export interface AssertPublicHostOptions {
  /** Overrides the DNS resolver — tests only; production always uses the real
   * `node:dns/promises` lookup (the default). */
  resolve?: HostResolver;
}

/**
 * Throws `ForbiddenHostError` unless `url`'s host is (and, for a hostname, every address
 * it resolves to is) a public address. A literal IP host is checked directly; a hostname
 * is resolved via DNS and EVERY returned address is checked — a hostname that resolves
 * to even one forbidden address is rejected, not just the first one a resolver happens
 * to return first.
 *
 * This function ONLY validates `url` itself — it says nothing about where a redirect
 * response from that URL might point. A validated PUBLIC host can still 302 to a
 * private/loopback address (or cloud metadata), and this check does not re-run against
 * a redirect target (there is no hook here for that — a caller that lets its `fetch()`
 * follow redirects would silently reopen the exact hole this function exists to close).
 * `routes/lookup.ts`'s caller closes this off completely on its side by passing
 * `redirect: 'error'` to `fetch()`, refusing EVERY redirect outright rather than trying
 * to re-validate each hop.
 *
 * KNOWN LIMITATION (accepted, not fixed): this is still a resolve-THEN-fetch check, not
 * an atomic one, for the ORIGINAL host. A DNS-rebinding attacker who controls the target
 * hostname's DNS record could have it answer with a public address here and a private
 * one moments later when `fetch()` itself re-resolves and actually connects. Closing
 * that gap fully would need either pinning the exact address this check resolved for
 * the real connection (not expressible through the plain `fetch()` API without a custom
 * dispatcher/agent) or a network-level egress block — out of scope here. Accepted as a
 * residual risk given this endpoint is already `editor`-role-gated (not anonymous/
 * public) in a small, largely self-hosted taproom app, not a multi-tenant "fetch any
 * URL" service.
 */
export async function assertPublicHost(url: URL, opts: AssertPublicHostOptions = {}): Promise<void> {
  const resolve = opts.resolve ?? defaultResolver;
  // URL wraps a literal IPv6 host in brackets ("[::1]"); net.isIP() doesn't recognize
  // the brackets, so they're stripped before every check below.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname)) {
    if (isForbiddenAddress(hostname)) {
      throw new ForbiddenHostError('That image URL is not allowed');
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    // Can't resolve it at all -> can't prove it's safe -> fail closed.
    throw new ForbiddenHostError('That image URL is not allowed');
  }
  if (addresses.length === 0 || addresses.some((addr) => isForbiddenAddress(addr))) {
    throw new ForbiddenHostError('That image URL is not allowed');
  }
}
