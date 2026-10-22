# Set up Kegtron Pro (cloud + UDP)

Kegtron Pro devices report through Kegtron's own cloud service (`mdash.net`). This app
talks to that cloud API directly — it never needs the official Kegtron dashboard/app
running, just an API key from it.

## Get your API key

1. Log in to [dashboard.kegtron.com](https://dashboard.kegtron.com).
2. Open the **Account** tab.
3. Copy your API key.
4. In Kegwall's admin UI: **Settings -> Kegtron -> API key**, paste it in, save.

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

The same holds across restarts. On startup the cloud source backfills servings since its last
run, and each replayed serving is checked against pours already saved on that tap (any keg it
has had, within 90 seconds and a similar volume). Pours that were recorded live before an
upgrade, restart, or settings change are therefore not counted again. A replayed older pour
is also never credited to whoever is currently signed in at the tablet.

### When UDP goes silent

A powered Kegtron Pro broadcasts about once a second even while idle, so silence always means
the packets aren't reaching this process. The source reports that itself rather than leaving you
to guess:

- **Analytics -> Ingest sources** marks `kegtron_udp` **down** after three minutes of silence,
  with the reason in the detail column. It no longer claims "listening" forever while nothing
  arrives.
- **The container log** records one line per start saying whether the multicast group was
  actually joined, and logs a failed periodic re-join as an error — that failure ejects the
  process from the group until restart, and used to be swallowed silently:

  ```sh
  docker logs kegwall 2>&1 | grep kegtron_udp
  ```

- **Analytics -> UDP packet coverage** falls back to the full 14-day retention window when the
  last 24 hours are empty, so a stream that died days ago is distinguishable from one that never
  worked. Counts are buffered in memory and flushed once a minute, so a server restarting more
  often than that never persists one.

"No packet has EVER arrived" means topology — VLANs, Docker bridge instead of host networking,
or UDP streaming switched off on the device. "No packets for N minutes" after a healthy period
means a dropped multicast membership or a device that stopped broadcasting.

## Name a device, or turn one off

Every discovered device — Kegtron Pro, Kegtron Gen 1, and Govee sensor alike — gets a card
on **Monitors** (editor role or higher) with two device-level controls:

- **Rename** gives the device a friendly name ("Keezer", "Cellar sensor"). The name is what
  the sensor charts on Analytics and the dashboard sensor cards use; unnamed devices fall
  back to their identifier.
- **Disable** is for hardware that reports in but isn't part of *this* wall — a keezer at
  another location, say. A disabled device keeps its card (greyed, with a `DISABLED` badge)
  so you can turn it back on, but it stops feeding the system entirely: no volume updates,
  no pours recorded, no temperature/humidity history, and it charts nowhere on Analytics.
  Its last-seen timestamp still updates, so you can tell it's alive and simply muted.

## See also

- [docs/install/docker.md](../install/docker.md) — host-network requirement for UDP under
  Docker.
- [docs/setup/home-assistant.md](home-assistant.md) — publishing tap state to Home
  Assistant over MQTT.
