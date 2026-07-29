# Backup and recovery

Read this before you need it — especially the crash-loop recovery section, which you
can't look up from a working admin UI once you're in that situation.

## Backing up

**Settings -> Backup -> "Download backup"** (admin role required). This downloads a
single file (`kegtron-dashboard-backup-YYYY-MM-DD.db`) containing everything: beers,
taps, kegs, pours, users, and settings.

Under the hood (`src/server/routes/backup.ts`): it uses better-sqlite3's own online backup
API to stage a consistent snapshot in a temp directory first, then streams that snapshot
down and deletes the temp copy once the download finishes. This is safe to run against a
live, concurrently-written database — it will not grab a torn or inconsistent snapshot
mid-write, unlike copying the raw `app.db` file yourself while the server is running.

Back this up on a schedule you actually trust — there is no automatic/scheduled backup
built into the app. If you're running in Docker, you can also snapshot the whole `/data`
volume from outside the app; see [docs/install/docker.md#backing-up-and-restoring](install/docker.md#backing-up-and-restoring).

## Restoring

**Settings -> Backup -> "Restore from a backup"** (admin role required). Pick a `.db`
file (max 50MB), type `restore` to confirm (deliberately the strongest confirmation
gate in the app — this replaces **all** current data, with no undo), submit.

**This does not take effect immediately.** The upload is validated (checked for a real
SQLite file header — a non-database file is rejected outright with a clear error) and
staged as `pending-restore.db` in your data directory. The actual swap only happens once,
atomically, the next time the server process starts. The UI tells you this explicitly:
"Restore staged. Restart the server to apply it — this replaces all current data."

So after uploading, you must restart the server yourself:

- Docker: `docker compose restart` (or `docker restart kegtron-dashboard`).
- Bare metal / systemd: `sudo systemctl restart kegtron-dashboard` (or however you're
  running the process).

On that next startup (`applyPendingRestore()` in `src/server/db/db.ts`), before anything
else touches the database:

1. The current `app.db` (and its `-wal`/`-shm` files, if present — SQLite's WAL-mode
   sidecar files) are renamed to `app.db.bak` (`-wal`/`-shm` too).
2. `pending-restore.db` is renamed to `app.db`.
3. The server then opens that file and runs its normal startup migrations against it.

That `app.db.bak` is your safety net — it's an exact copy of whatever was live
**immediately before** the restore, kept around specifically so you're never one bad
upload away from actually losing data. It is not automatically cleaned up.

## Manual crash-loop recovery

**When you need this:** the uploaded file passed the SQLite-header check (so it looked
like a real database file) but turns out to be corrupt, from an incompatible/future schema
version, or otherwise fails during startup migration. The swap described above (steps 1-3)
only happens **once** — on the first boot after staging, because it's gated on
`pending-restore.db` existing, and that file is renamed away as part of the swap itself.
The problem is what happens after: the (now bad) file is permanently `app.db`, so if
opening it or running migrations against it throws, **the server fails to finish starting
up, every time it's retried** — under `restart: unless-stopped` (Docker) or systemd's
`Restart=on-failure`, that's a restart loop with no way to reach the admin UI to fix it
from there, since the server never finishes starting.

Recovery is a manual filesystem operation. Stop the server first so nothing is mid-write:

**Docker:**

```sh
docker compose down
# The data volume persists across `down` — inspect/edit its contents via a throwaway container:
docker run --rm -it -v deploy_kegtron-data:/data alpine sh
```

Inside that shell (or via `docker cp` in/out if you prefer working on the host):

```sh
cd /data
rm -f app.db app.db-wal app.db-shm      # the broken restored file
mv app.db.bak app.db
[ -f app.db.bak-wal ] && mv app.db.bak-wal app.db-wal
[ -f app.db.bak-shm ] && mv app.db.bak-shm app.db-shm
exit
```

```sh
docker compose up -d
```

**Bare metal:**

```sh
sudo systemctl stop kegtron-dashboard   # or however you run it

cd "$DATA_DIR"   # wherever you pointed DATA_DIR, e.g. ./data
rm -f app.db app.db-wal app.db-shm
mv app.db.bak app.db
[ -f app.db.bak-wal ] && mv app.db.bak-wal app.db-wal
[ -f app.db.bak-shm ] && mv app.db.bak-shm app.db-shm

sudo systemctl start kegtron-dashboard
```

This discards whatever was in the failed restore attempt and returns you exactly to the
state the server was in right before you restored — no partial migration, no half-applied
schema, because `app.db.bak` was never touched by the failed migration attempt at all (it
was renamed *out of the way* before the new file was ever opened).

If `app.db.bak` doesn't exist (e.g. this was a fresh install with no prior database),
there's nothing to roll back to — you'll need a different backup file, or to start over
with `Settings -> Backup` once the server is running again from an empty database.

## See also

- [docs/install/docker.md](install/docker.md) — volume-level backup independent of the app.
