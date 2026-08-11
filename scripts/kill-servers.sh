#!/bin/sh
# Kills every local dev server (wrangler dev and workerd, parents and children together), then
# asserts ports 8787 and 8788 are actually free. Exists because an orphaned wrangler holding 8787
# has cost this project hours across two phases; see docs/RUNNING.md, "Clearing stale servers".
#
# Deliberately not the one-liner `kill $(lsof -ti:8787)`: that PID is the workerd child, and its
# wrangler parent immediately respawns it. Deliberately not a bare `pkill -f 'wrangler dev'` either:
# that pattern can match the calling shell's own command line, so the caller kills itself.
#
# POSIX sh and BSD/GNU-portable tools only: macOS is the primary environment, the devcontainer is
# Linux. PID lists are held as space-separated shell strings rather than newline-separated ones,
# because BSD awk rejects a newline inside an `awk -v` value ("awk: newline in string") - the first
# version of this script used that and failed on macOS while appearing to work.
set -u

PORTS="8787 8788"
# Matched as extended regexes against full command lines. workerd is listed separately from wrangler
# because orphans reparented to PID 1 outlive their parent and do not match "wrangler" at all: one
# was found seventeen minutes old, holding three high ports, invisible to `pgrep -af wrangler`.
PATTERNS="wrangler.dev workerd"

# True when $1 appears in the space-separated list $2.
in_list() {
  for item in $2; do
    [ "$item" = "$1" ] && return 0
  done
  return 1
}

# This script's own PID plus every ancestor up to init. These must never be signalled: the caller's
# command line may itself contain "wrangler dev" (an agent shell, an npm script chain), which is
# exactly how a naive pkill kills the process that invoked it.
protected_pids() {
  result=$$
  pid=$$
  while [ "$pid" -gt 1 ]; do
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -n "$pid" ] || break
    result="$result $pid"
  done
  echo "$result"
}

# Adds every descendant of the given PIDs to the list, so a wrangler parent and its workerd child
# are killed in one batch. Killing them one at a time lets a surviving parent respawn the child.
with_descendants() {
  found="$1"
  pairs=$(ps -Ao pid=,ppid= 2>/dev/null)
  # Repeat until no new PIDs appear, so grandchildren are caught too, not just direct children.
  while :; do
    added=""
    for candidate_pair in $(printf '%s\n' "$pairs" | tr -s ' ' ' ' | sed 's/^ //; s/ /:/'); do
      child=${candidate_pair%%:*}
      parent=${candidate_pair##*:}
      if in_list "$parent" "$found" && ! in_list "$child" "$found" && ! in_list "$child" "$added"; then
        added="$added $child"
      fi
    done
    [ -n "$added" ] || break
    found="$found$added"
  done
  echo "$found"
}

# True when the PID's argv[0] is a program that actually runs a dev server. A full-command-line
# pattern matches any process that merely mentions wrangler - another agent shell, an editor task, a
# grep - and killing those was observed during testing. Checking the executable keeps only the real
# thing: /bin/sh and /bin/zsh wrappers are dropped, and the node/workerd processes they spawn are
# matched directly, so the whole family is still caught.
is_server_process() {
  program=$(ps -o command= -p "$1" 2>/dev/null | awk '{ print $1 }')
  case ${program##*/} in
    node | node[0-9]* | wrangler | workerd) return 0 ;;
    *) return 1 ;;
  esac
}

# The PIDs to kill: pattern matches, expanded to their descendants, minus the protected set. pgrep
# never reports itself, so the caller chain is the only self-kill risk and protected_pids covers it.
targets() {
  matched=""
  for pattern in $PATTERNS; do
    for pid in $(pgrep -f "$pattern" 2>/dev/null); do
      if ! in_list "$pid" "$matched" && is_server_process "$pid"; then
        matched="$matched $pid"
      fi
    done
  done
  [ -n "$matched" ] || return 0
  keep=$(protected_pids)
  # Protected PIDs are dropped before the descendant walk, not only after it. The caller's own shell
  # often matches (its command line mentions wrangler), and expanding its descendants would sweep up
  # unrelated siblings such as the caller's other tooling. The real servers match directly anyway:
  # wrangler by "wrangler dev" and each workerd by name.
  seed=""
  for pid in $matched; do
    in_list "$pid" "$keep" || seed="$seed $pid"
  done
  [ -n "$seed" ] || return 0
  # Walk up as well as down. Observed on macOS: killing the matched `node ... wrangler dev` process
  # and its workerd children left a second node process, the one that actually supervises workerd,
  # which respawned it on the same port within a second. Its own command line does not contain
  # "wrangler dev", so only the parent walk finds it. is_server_process keeps this to node/workerd
  # ancestors, so an npm or shell ancestor is never signalled.
  for pid in $seed; do
    parent=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    while [ -n "$parent" ] && [ "$parent" -gt 1 ]; do
      if in_list "$parent" "$keep" || ! is_server_process "$parent"; then break; fi
      in_list "$parent" "$seed" || seed="$seed $parent"
      parent=$(ps -o ppid= -p "$parent" 2>/dev/null | tr -d ' ')
    done
  done
  result=""
  for pid in $(with_descendants "$seed"); do
    in_list "$pid" "$keep" || result="$result $pid"
  done
  echo "$result"
}

# Sends SIGKILL to a whole PID list at once. SIGKILL rather than SIGTERM because wrangler traps TERM
# and can take seconds to leave, and this runs reflexively before every start. One call rather than a
# loop, so there is no window in which a surviving parent respawns a child that was already killed.
kill_all() {
  [ -n "$1" ] || return 0
  # shellcheck disable=SC2086 # word splitting is the point: one signal batch for the whole family
  kill -9 $1 2>/dev/null || true
}

# True when either port has a listener.
ports_busy() {
  for port in $PORTS; do
    [ -n "$(holders "$port")" ] && return 0
  done
  return 1
}

# lsof is the documented tool and ships with macOS; ss is the fallback for a minimal Linux
# container. Resolved up front rather than inside holders(), because holders() runs in a command
# substitution where an exit would only leave the subshell and yield a false "the port is free".
if command -v lsof >/dev/null 2>&1; then
  PORT_TOOL=lsof
elif command -v ss >/dev/null 2>&1; then
  PORT_TOOL=ss
else
  echo "kill-servers: neither lsof nor ss is available, so the ports cannot be verified" >&2
  exit 2
fi

# The PIDs listening on a port.
holders() {
  if [ "$PORT_TOOL" = lsof ]; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null
  else
    ss -Hltnp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2
  fi | sort -u
}

# One readable line naming a PID, for the failure message.
describe() {
  ps -o pid=,command= -p "$1" 2>/dev/null | sed 's/^ *//'
}

victims=$(targets)
kill_all "$victims"

# A killed process releases its sockets asynchronously, so poll rather than sleep a fixed time. Each
# pass re-runs targets(), because a supervisor that survived the first batch can respawn a child in
# the meantime, and a single batch is then not enough.
attempt=0
while [ "$attempt" -lt 8 ] && ports_busy; do
  sleep 1
  again=$(targets)
  kill_all "$again"
  victims="$victims$again"
  attempt=$((attempt + 1))
done

# The assertion is the whole point: an unasserted cleanup is worse than none, because it hides the
# problem. Name what still holds the port so the caller can act instead of guessing.
status=0
for port in $PORTS; do
  for pid in $(holders "$port"); do
    echo "kill-servers: port $port is still held by $(describe "$pid")" >&2
    status=1
  done
done
if [ "$status" -ne 0 ]; then
  echo "kill-servers: the process above was left alone because it is not wrangler or workerd. Stop it by hand before starting the app." >&2
  exit 1
fi

# Quiet on the common path (nothing was running); one line when something was actually killed. PIDs
# are deduplicated because the poll loop can report the same process in more than one pass.
if [ -n "$victims" ]; then
  # shellcheck disable=SC2086 # unquoted so each PID becomes its own printf argument, hence its own line
  count=$(printf '%s\n' $victims | sort -u | wc -l | tr -d ' ')
  echo "kill-servers: killed $count process(es); ports $PORTS are free"
fi
exit 0
