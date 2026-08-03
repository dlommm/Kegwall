# /etc/profile.d/kegwall-setup.sh — dropped by the Kegwall preseed.
# On the FIRST interactive login (e.g. your first SSH session), kick off the Kegwall install so you
# can watch it, then get out of the way forever. SSH itself is already up independently of this, so
# a slow or failed setup never keeps you from logging in. Re-run any time with: sudo kegwall-setup
#
# Sourced by /etc/profile for login shells — uses `return`, never `exit`.

# Interactive shells on a real terminal only.
case $- in
  *i*) : ;;
  *) return 0 2>/dev/null || true ;;
esac
if [ -t 1 ]; then
  if [ ! -e /var/lib/kegwall-setup/done ] && [ ! -e /var/lib/kegwall-setup/running ]; then
    printf '\n=== Kegwall first-time setup ===\n'
    printf 'Installing Kegwall now (Ctrl-C to skip; re-run later with: sudo kegwall-setup).\n\n'
    if sudo /usr/local/sbin/kegwall-firstboot.sh; then
      printf '\nKegwall setup complete. Open http://%s from another device.\n\n' "$(hostname -I 2>/dev/null | awk '{print $1}')"
    else
      printf '\nSetup did not finish — re-run it with: sudo kegwall-setup\n\n'
    fi
  fi
fi
