#!/bin/sh
# Show the box's IP + how to reach it on the physical console login prompt, so after an unattended
# install you can read the address off the screen and SSH in. Run once by the preseed late_command.
# getty substitutes \4 with the machine's current IPv4 at display time, so this stays correct across
# DHCP changes. (Before Kegwall's setup runs, tty1 shows this login prompt; after a native-wall
# install, tty1 becomes the wall — by then you already have the IP.)
set -eu

if ! grep -q 'Kegwall' /etc/issue 2>/dev/null; then
  {
    printf '\n'
    printf 'Kegwall  ·  wall/admin: http://\\4/   ·   ssh kegadmin@\\4\n'
    printf 'Log in over SSH to run setup (or watch it here).\n'
    printf '\n'
  } >> /etc/issue
fi
