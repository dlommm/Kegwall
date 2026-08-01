#!/usr/bin/env bash
# Kegwall display agent: listens to the server's presence SSE stream and runs real
# screen on/off commands. Zero dependencies beyond bash + curl (SSE-over-curl is why
# the endpoint exists — no node/python needed on a kiosk Pi).
#
# Config via environment (see display-agent.service / docs/install/display-agent.md):
#   KEGWALL_URL   e.g. http://192.168.1.50:8080
#   KEGWALL_WALL  wall slug, e.g. main
#   KEGWALL_TOKEN presence token from Settings → Integrations
#   SCREEN_ON_CMD / SCREEN_OFF_CMD  shell commands, e.g.:
#     TV over HDMI-CEC:      cec-ctl --to 0 --image-view-on / cec-ctl --to 0 --standby
#     X11 kiosk:             xset dpms force on / xset dpms force off
#     Wayland (wlr):         wlr-randr --output HDMI-A-1 --on / ... --off
#     Pi touchscreen:        echo 0 > /sys/class/backlight/*/bl_power / echo 1 > ...
set -u
: "${KEGWALL_URL:?}" "${KEGWALL_WALL:?}" "${KEGWALL_TOKEN:?}" "${SCREEN_ON_CMD:?}" "${SCREEN_OFF_CMD:?}"

last_state=""
apply() { # $1 = active|screensaver|off  (screensaver is an ON state for the panel)
  local want=on
  [ "$1" = "off" ] && want=off
  [ "$want" = "$last_state" ] && return
  last_state="$want"
  if [ "$want" = "off" ]; then bash -c "$SCREEN_OFF_CMD"; else bash -c "$SCREEN_ON_CMD"; fi
}

while true; do
  # -N disables buffering so events arrive as they're sent; the read loop parses
  # `data: {"state":"..."}` lines and ignores `: ping` comments.
  # NOTE: the while-read runs in a pipeline subshell, so `last_state` dedup resets
  # per connection (harmless — worst case one redundant ON command per reconnect).
  curl -sN --max-time 0 \
    "$KEGWALL_URL/api/presence/stream?wall=$KEGWALL_WALL&token=$KEGWALL_TOKEN" \
  | while IFS= read -r line; do
      case "$line" in
        data:*) state=$(printf '%s' "$line" | sed -n 's/.*"state":"\([a-z]*\)".*/\1/p')
                [ -n "$state" ] && apply "$state" ;;
      esac
    done
  # Connection dropped (server restart, network): screens ON is the safe default while
  # we can't hear the server, then retry with a short backoff.
  bash -c "$SCREEN_ON_CMD" || true
  last_state="on"
  sleep 5
done
