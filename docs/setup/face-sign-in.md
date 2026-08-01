# Set up face sign-in

Face sign-in lets the pourer tablet recognize a returning drinker's face and offer to
sign them in — one tap instead of hunting for your avatar in the grid. It's a
**convenience feature, not a security feature**: it saves a search through the avatar
grid, it does not gate who can pour. Anyone can still sign in the normal way (tap your
avatar), and a wrong-face match just gets rejected with one tap ("Not me").

## How it works

Everything runs **in the tablet's browser**, on-device, using
[Human](https://github.com/vladmandic/human) (self-hosted model files, no CDN, no
cloud). The tablet's camera feed is analyzed locally for a face, and only when one is
present is a numeric descriptor (an "embedding" — roughly 1024 floating-point numbers
that describe the face's geometry, not a photo) computed and matched against enrolled
drinkers. Camera frames never leave the tablet; the server only ever sees the
embedding.

## Privacy model

- **Opt-in.** Nothing is captured or matched until a drinker taps "Add my face" on the
  tablet themselves. Face sign-in is also off system-wide by default (below).
- **Embeddings only, not photos.** The server stores a numeric embedding per sample —
  never the camera frame or any image. Up to 5 samples per drinker are kept (adding a
  6th quietly evicts the oldest).
- **Deletable, self-serve or by an admin.** A drinker can remove their own face data
  from the tablet's armed screen at any time; an admin can also delete a drinker's face
  data from the Users page. Deleting removes every stored sample immediately.
- **Same trust class as the rest of the tablet/wall API.** Embeddings are exposed over
  `GET /api/public/faces` on the trusted LAN, unauthenticated — the same model as the
  pourer avatar grid (`/api/public/pourers`) and the public leaderboard. If your LAN
  isn't a trusted LAN, this isn't a feature you should turn on (see
  [docker.md's reverse-proxy/HTTPS notes](../install/docker.md#reverse-proxy-and-https)
  for exposing Kegwall beyond a trusted LAN generally).

## Enable it

**Settings → Integrations → Face sign-in**:

- **Enable face sign-in** — off by default; nothing runs on any tablet until this is
  checked.
- **Match threshold** — a number from `0.3` to `0.95` (default `0.6`). This is a cosine
  similarity cutoff: higher means a candidate face has to look *more* like a stored
  sample before the tablet offers a match; lower means it takes less similarity to
  offer one.
  - **Raise it** if the tablet is offering the wrong person (false matches).
  - **Lower it** if it's failing to recognize people who really are enrolled (missed
    matches).
  - An ambiguous read (more than one drinker scoring close together) is treated as no
    match and stays silent rather than guessing — so tightening the threshold mostly
    trades "offers a match" for "asks you to just tap your avatar instead," not for
    wrong answers.

## Enroll a face

Enrollment happens on the **tablet's armed screen** — the screen you land on after
tapping your avatar to arm a pour, not the wall or the admin UI:

- **Not yet enrolled**: an **"Add my face"** button starts a short capture loop.
- **Already enrolled**: the screen instead shows **"Face sign-in: enrolled"** with a
  **"Remove my face data"** action, so you can back out at any time.

Once enrolled, later visits to the armed/pourer screen quietly watch for motion; when a
face is detected and matches you above the threshold, a confirm sheet pops up —
**"You pouring, NAME?"** — with **"Yes, that's me"** / **"Not me"**. Confirming runs the
same arm-and-pour flow as tapping your avatar normally would have.

If no camera is available, or the OS/browser never grants camera access, face sign-in
just doesn't activate — the tablet falls back to the normal avatar grid with no error
banner. If enrollment's camera never comes up at all, the tablet says so plainly
("Camera unavailable — check the tablet's camera permission") rather than pretending no
face was found; a mid-capture save that fails shows "Couldn't save — try again" with a
retry, distinct from an honest "no face found."

## Platform notes

- **Android tablet app**: the camera permission is requested on first launch (a normal
  Android runtime permission prompt) — see
  [docs/install/android-tablet.md](../install/android-tablet.md#camera-permission-face-sign-in).
- **Raspberry Pi touchscreen tablet (Chromium kiosk)**: kiosk Chromium usually still
  shows its own one-time "use your camera?" prompt — see
  [docs/install/raspberry-pi.md](../install/raspberry-pi.md#tablet-mode-dedicated-touchscreen-pi)
  for why that grant sticks across reboots, and a fallback flag if your kiosk build
  never surfaces the prompt at all.

## Troubleshooting

- **No "Add my face" button appears.** Face sign-in is disabled in Settings →
  Integrations, or the tablet has no camera / camera access was denied — check the
  platform notes above.
- **Enrolled, but the confirm sheet never appears.** Lower the match threshold a
  little; also make sure lighting is reasonable — the pipeline needs a clear, mostly
  front-on view before it computes a descriptor at all.
- **Wrong person keeps getting offered.** Raise the match threshold; if it doesn't
  settle down, remove and re-enroll (stale samples from bad lighting can drag the
  average down).
- **Model files fail to load / face sign-in silently never activates.** Models are
  self-hosted at `/models/` (blazeface, facemesh, faceres — no external CDN calls). If
  those 404, the web build didn't ship them; rebuild (`npm run build`) and confirm
  `dist/web/models/` exists.
- **A drinker wants their face data gone.** They can do it themselves from the tablet's
  armed screen ("Remove my face data"), or an admin can delete it for them from the
  Users page ("Delete face data" next to their sample count). Either way it's
  immediate and removes every stored sample.
