import { describe, it, expect } from 'vitest';
import {
  isForbiddenAddress, assertPublicHost, ForbiddenHostError,
} from '../../src/server/core/ssrfGuard.js';

describe('isForbiddenAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback, high end of 127.0.0.0/8'],
    ['10.0.0.1', 'private 10/8'],
    ['10.255.255.255', 'private 10/8, high end'],
    ['172.16.0.1', 'private 172.16/12, low end'],
    ['172.31.255.255', 'private 172.16/12, high end'],
    ['192.168.1.1', 'private 192.168/16'],
    ['169.254.169.254', 'link-local (cloud metadata)'],
    ['169.254.0.1', 'link-local 169.254/16'],
    ['0.0.0.0', 'unspecified'],
  ])('flags %s as forbidden (%s)', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  it.each([
    ['172.15.255.255', 'just below the 172.16/12 private range'],
    ['172.32.0.0', 'just above the 172.16/12 private range'],
    ['192.167.255.255', 'just below 192.168/16'],
    ['192.169.0.0', 'just above 192.168/16'],
    ['8.8.8.8', 'a real public IP (Google DNS)'],
    ['1.1.1.1', 'a real public IP (Cloudflare DNS)'],
    ['203.0.113.5', 'TEST-NET-3 documentation range (treated as public — not in scope)'],
  ])('does not flag %s (%s)', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });

  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local, low end'],
    ['febf::1', 'link-local, high end of fe80::/10'],
    ['fc00::1', 'unique-local, low end'],
    ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'unique-local, high end of fc00::/7'],
  ])('flags IPv6 %s as forbidden (%s)', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  it.each([
    ['2001:4860:4860::8888', 'a real public IPv6 (Google DNS)'],
    ['fec0::1', 'just above the fe80::/10 link-local range'],
  ])('does not flag IPv6 %s (%s)', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });

  it('flags an IPv4-mapped IPv6 address by its embedded IPv4 rules', () => {
    expect(isForbiddenAddress('::ffff:192.168.1.1')).toBe(true);
    expect(isForbiddenAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isForbiddenAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('fails closed for something that is not a valid IP literal at all', () => {
    expect(isForbiddenAddress('not-an-ip')).toBe(true);
    expect(isForbiddenAddress('')).toBe(true);
  });
});

describe('assertPublicHost', () => {
  it('resolves without throwing for a literal public IPv4 host', async () => {
    await expect(assertPublicHost(new URL('http://8.8.8.8/x'))).resolves.toBeUndefined();
  });

  it('throws ForbiddenHostError for a literal loopback IPv4 host, without calling any resolver', async () => {
    let resolverCalled = false;
    await expect(assertPublicHost(new URL('http://127.0.0.1/x'), {
      resolve: async () => {
        resolverCalled = true;
        return ['8.8.8.8'];
      },
    })).rejects.toThrow(ForbiddenHostError);
    expect(resolverCalled).toBe(false);
  });

  it('throws for a literal loopback IPv6 host (bracketed, as URL.hostname produces it)', async () => {
    expect(new URL('http://[::1]/x').hostname).toBe('[::1]');
    await expect(assertPublicHost(new URL('http://[::1]/x'))).rejects.toThrow(ForbiddenHostError);
  });

  it('throws when the injected resolver returns a private address for a hostname', async () => {
    await expect(assertPublicHost(new URL('http://internal.example.test/x'), {
      resolve: async () => ['10.0.0.5'],
    })).rejects.toThrow(ForbiddenHostError);
  });

  it('throws when ANY resolved address is private, even if others are public', async () => {
    await expect(assertPublicHost(new URL('http://multi.example.test/x'), {
      resolve: async () => ['8.8.8.8', '169.254.169.254'],
    })).rejects.toThrow(ForbiddenHostError);
  });

  it('resolves without throwing when every resolved address is public', async () => {
    await expect(assertPublicHost(new URL('http://public.example.test/x'), {
      resolve: async () => ['8.8.8.8', '1.1.1.1'],
    })).resolves.toBeUndefined();
  });

  it('throws when the resolver returns no addresses at all', async () => {
    await expect(assertPublicHost(new URL('http://nowhere.example.test/x'), {
      resolve: async () => [],
    })).rejects.toThrow(ForbiddenHostError);
  });

  it('fails closed when the resolver itself throws (e.g. NXDOMAIN)', async () => {
    await expect(assertPublicHost(new URL('http://does-not-exist.example.test/x'), {
      resolve: async () => { throw new Error('ENOTFOUND'); },
    })).rejects.toThrow(ForbiddenHostError);
  });

  it('uses the exact "That image URL is not allowed" message', async () => {
    await expect(assertPublicHost(new URL('http://127.0.0.1/x')))
      .rejects.toThrow('That image URL is not allowed');
  });
});
