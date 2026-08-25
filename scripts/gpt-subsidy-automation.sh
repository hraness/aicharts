#!/bin/sh

set -eu

canonical_origin="https://github.com/hraness/aicharts.git"
installed_name="aicharts-publish-gpt-subsidy"
requested_mode="${1:-run}"
lock_fd=""

if [ "$requested_mode" = "__aicharts_subsidy_locked" ]; then
  if [ "$#" -ne 3 ]; then
    printf '%s\n' "Invalid internal GPT subsidy lock invocation." >&2
    exit 65
  fi
  mode="$2"
  lock_fd="$3"
else
  if [ "$#" -gt 1 ]; then
    printf '%s\n' "Usage: $0 [install|prepare|run]" >&2
    exit 64
  fi
  mode="$requested_mode"
fi

if [ "$mode" = "install" ]; then
  bin_directory="${XDG_BIN_HOME:-${HOME}/.local/bin}"
  destination="${bin_directory}/${installed_name}"
  mkdir -p "$bin_directory"
  install -m 0755 "$0" "$destination"
  "$destination" prepare
  printf '%s\n' "Installed ${destination}."
  exit 0
fi

if [ "$mode" != "run" ] && [ "$mode" != "prepare" ]; then
  printf '%s\n' "Usage: $0 [install|prepare|run]" >&2
  exit 64
fi

# Publishing always reads the real local Codex ledger and verifies the canonical
# production URL. Fixture and profile overrides are valid only in nonpublishing
# test harnesses, never in the installed direct-main automation.
unset AICHARTS_GPT_SUBSIDY_HOME
unset AICHARTS_SUBSIDY_LOCK_HELD
unset AICHARTS_SUBSIDY_VERIFY_URL
unset GPT_SUBSIDY_LEDGER_COMMAND
unset TOKSCALE_CONFIG_DIR

export CI=1
export GCM_INTERACTIVE=Never
export GIT_ASKPASS=/usr/bin/false
export GIT_EDITOR=true
export GIT_SEQUENCE_EDITOR=true
export GIT_SSH_COMMAND="ssh -oBatchMode=yes -oConnectTimeout=15"
export GIT_TERMINAL_PROMPT=0
export NO_COLOR=1
export SSH_ASKPASS=/usr/bin/false

state_root="${AICHARTS_SUBSIDY_AUTOMATION_ROOT:-${XDG_DATA_HOME:-${HOME}/.local/share}/aicharts/gpt-subsidy-publisher}"
checkout="${state_root}/repository"
lock_file="${state_root}/run.lock"
clone_parent=""

cleanup() {
  if [ -n "$clone_parent" ] && [ -d "$clone_parent" ]; then
    case "$clone_parent" in
      "${state_root}"/clone.*) rm -rf -- "$clone_parent" ;;
      *) printf '%s\n' "Refusing to remove unexpected clone path ${clone_parent}." >&2 ;;
    esac
  fi
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$state_root"
if [ -z "$lock_fd" ]; then
  set +e
  perl -MFcntl=:flock,F_SETFD -e '
    my ($lock_path, $script, $mode) = @ARGV;
    open my $lock, ">>", $lock_path or die "open $lock_path: $!";
    if (!flock($lock, LOCK_EX | LOCK_NB)) {
      print STDERR "GPT subsidy publication is already running.\n";
      exit 75;
    }
    fcntl($lock, F_SETFD, 0) or die "clear close-on-exec: $!";
    my $fd = fileno($lock);
    exec {$script} $script, "__aicharts_subsidy_locked", $mode, $fd
      or die "exec $script: $!";
  ' "$lock_file" "$0" "$mode"
  lock_status=$?
  set -e
  exit "$lock_status"
fi

case "$lock_fd" in
  ''|*[!0-9]*)
    printf '%s\n' "Invalid inherited GPT subsidy lock descriptor." >&2
    exit 65
    ;;
esac
if ! perl -MFcntl=:flock -e '
  my ($fd, $lock_path) = @ARGV;
  open my $lock, "<&=$fd" or exit 1;
  my @descriptor = stat($lock);
  my @path = stat($lock_path);
  exit 1 unless @descriptor && @path
    && $descriptor[0] == $path[0]
    && $descriptor[1] == $path[1]
    && flock($lock, LOCK_EX | LOCK_NB);
' "$lock_fd" "$lock_file"; then
  printf '%s\n' "Inherited GPT subsidy descriptor does not own the publisher lock." >&2
  exit 65
fi

git_network() {
  bounded 120 git \
    -c core.hooksPath=/dev/null \
    -c credential.interactive=never \
    -c http.lowSpeedLimit=1 \
    -c http.lowSpeedTime=30 \
    "$@"
}

bounded() {
  seconds="$1"
  shift
  perl -e '$seconds = shift @ARGV; alarm $seconds; exec @ARGV or die "exec failed: $!"' \
    "$seconds" \
    "$@"
}

canonical_remote() {
  case "$1" in
    https://github.com/hraness/aicharts|https://github.com/hraness/aicharts.git|git@github.com:hraness/aicharts|git@github.com:hraness/aicharts.git|ssh://git@github.com/hraness/aicharts|ssh://git@github.com/hraness/aicharts.git)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if [ ! -d "${checkout}/.git" ]; then
  if [ -e "$checkout" ]; then
    printf '%s\n' "Refusing to replace non-repository path ${checkout}." >&2
    exit 65
  fi
  clone_parent=$(mktemp -d "${state_root}/clone.XXXXXX")
  git_network clone \
    --branch main \
    --no-tags \
    --single-branch \
    "$canonical_origin" \
    "${clone_parent}/repository"
  mv "${clone_parent}/repository" "$checkout"
  rmdir "$clone_parent"
  clone_parent=""
fi

fetch_urls=$(git -C "$checkout" remote get-url --all origin)
push_urls=$(git -C "$checkout" remote get-url --push --all origin)
if ! canonical_remote "$fetch_urls" || ! canonical_remote "$push_urls"; then
  printf '%s\n' "Refusing noncanonical automation checkout origin." >&2
  exit 65
fi

branch=$(git -C "$checkout" symbolic-ref --quiet --short HEAD || true)
if [ "$branch" != "main" ]; then
  printf '%s\n' "Automation checkout must remain on main; found ${branch:-detached HEAD}." >&2
  exit 65
fi

dirty=$(git -C "$checkout" status --porcelain=v1 --untracked-files=all)
if [ -n "$dirty" ]; then
  printf '%s\n' "Automation checkout is unexpectedly dirty; refusing to discard it." >&2
  exit 65
fi

git_network -C "$checkout" fetch \
  --no-tags \
  --prune \
  --no-recurse-submodules \
  origin \
  +refs/heads/main:refs/remotes/origin/main
if ! bounded 120 git \
  -c core.hooksPath=/dev/null \
  -C "$checkout" \
  merge --ff-only --no-edit refs/remotes/origin/main; then
  printf '%s\n' "Automation checkout cannot fast-forward exactly to origin/main." >&2
  exit 65
fi

local_head=$(git -C "$checkout" rev-parse --verify 'HEAD^{commit}')
remote_head=$(git -C "$checkout" rev-parse --verify 'refs/remotes/origin/main^{commit}')
if [ "$local_head" != "$remote_head" ]; then
  printf '%s\n' \
    "Automation checkout is not exactly origin/main after synchronization; refusing local commits." >&2
  exit 65
fi

if [ -n "$(git -C "$checkout" status --porcelain=v1 --untracked-files=all)" ]; then
  printf '%s\n' "Automation checkout became dirty while synchronizing." >&2
  exit 65
fi

if [ "$mode" = "prepare" ]; then
  printf '%s\n' "Prepared clean GPT subsidy automation checkout at ${checkout}."
  exit 0
fi

if [ -n "${AICHARTS_BUN:-}" ]; then
  bun_executable="$AICHARTS_BUN"
elif command -v bun >/dev/null 2>&1; then
  bun_executable=$(command -v bun)
elif [ -x "${HOME}/.bun/bin/bun" ]; then
  bun_executable="${HOME}/.bun/bin/bun"
else
  printf '%s\n' "Bun is required to publish GPT subsidy data." >&2
  exit 69
fi

(
  cd "$checkout"
  bounded 10800 "$bun_executable" run scripts/publish-gpt-subsidy.ts
)
