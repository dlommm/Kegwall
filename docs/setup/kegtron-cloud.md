# Set up Kegtron Pro (cloud + UDP)

Kegtron Pro devices report through Kegtron's own cloud service (`mdash.net`). This app
talks to that cloud API directly — it never needs the official Kegtron dashboard/app
running, just an API key from it.

## Get your API key

1. Log in to [dashboard.kegtron.com](https://dashboard.kegtron.com).
2. Open the **Account** tab.
3. Copy your API key.
4. In Kegtron Dashboard's admin UI: **Settings -> Kegtron -> API key**, paste it in, save.

That one key is all this app needs — device discovery, live updates, and historical
backfill all flow through it. The Settings page's own description: "The mdash.net API key
used to import Kegtron Pro devices and reset on-device volume counters."

## What this powers

Once the key is set, `KegtronCloudSource` (`src/server/ingest/kegtron/cloudSource.ts`)
does two things automatically, no further action needed:

- **Discovery** — calls mdash.net's Customer endpoint to find every device on your
  account, then reads each device's shadow (its cloud-synced state: keg levels, beer
  metadata, sensor readings).
- **Live updates** — opens a per-device WebSocket to mdash.net's notify channel
  (`wss://mdash.net/api/v2/m/device/notify`) for real-time push updates, falling back to
  polling every 5 minutes if a socket drops and can't reconnect.

Cloud reporting has inherent latency (the device -> cloud -> this app round trip) — good
enough for most use, but if you want faster in-progress-pour updates on the wall, enable
UDP too (below).

## Enable UDP for faster local updates (optional)

Kegtron Pro devices can additionally push their readings directly over the local network
via UDP multicast, bypassing the cloud round-trip entirely
(`docs/kegtron/UDPStreaming.pdf`; see `src/server/ingest/kegtron/udpSource.ts`'s header
comment for the full protocol citation). Where cloud updates arrive with 5-30s of lag,
UDP packets arrive at up to 1/sec while idle and every 200ms during an active pour — this
is what makes a "pouring" indicator on the wall feel live instead of laggy.

To use it:

1. Your Kegtron Pro device must be on the same local network as the machine running this
   app, and configured (via Kegtron's own device settings — outside this app's control) to
   broadcast UDP on its LAN. Consult Kegtron's own device documentation for how to turn
   that on if it isn't already.
2. In this app's admin UI: **Settings -> Sources -> "Listen for Kegtron UDP broadcasts"**.
   The UI's own note is accurate and worth repeating: "Only detects devices broadcasting
   on this server's local network — not across the internet."
3. **If you're running in Docker**, the default bridge network will not receive UDP
   multicast traffic — you need the host-network compose variant. See
   [docs/install/docker.md#networking-bridge-vs-host-mode](../install/docker.md#networking-bridge-vs-host-mode).

Nothing else changes: UDP is purely an additional, faster signal for devices the cloud
source has already discovered (or will discover) — you still need the API key configured
above for beer/keg metadata, historical data, and any device UDP alone can't cover. If
both cloud and UDP report the same pour, the app deduplicates it (`PourDeduper`) so it's
recorded once, not twice.

## See also

- [docs/install/docker.md](../install/docker.md) — host-network requirement for UDP under
  Docker.
- [docs/setup/home-assistant.md](home-assistant.md) — publishing tap state to Home
  Assistant over MQTT.
