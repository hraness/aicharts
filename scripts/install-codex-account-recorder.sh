#!/bin/sh

set -eu

mode="${1:-install}"
if [ "$#" -gt 1 ] || { [ "$mode" != "install" ] && [ "$mode" != "uninstall" ]; }; then
  printf '%s\n' "Usage: $0 [install|uninstall]" >&2
  exit 64
fi

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_path="${script_directory}/record-codex-account.ts"
bin_directory="${XDG_BIN_HOME:-${HOME}/.local/bin}"
bin_path="${bin_directory}/aicharts-record-codex-account"
install_root="${XDG_DATA_HOME:-${HOME}/.local/share}/aicharts/gpt-subsidy-account-recorder"
installed_source="${install_root}/record-codex-account.ts"
state_root="${XDG_STATE_HOME:-${HOME}/.local/state}/aicharts/gpt-subsidy"

if [ "$mode" = "uninstall" ]; then
  rm -f -- "$bin_path" "$installed_source"
  rmdir "$install_root" 2>/dev/null || true
  printf '%s\n' "Uninstalled ${bin_path}. Private account observations remain in ${state_root}."
  exit 0
fi

if [ ! -f "$source_path" ] || [ -L "$source_path" ]; then
  printf '%s\n' "Account recorder source is missing or unsafe." >&2
  exit 65
fi

if command -v bun >/dev/null 2>&1; then
  bun_executable=$(command -v bun)
elif [ -x "${HOME}/.bun/bin/bun" ]; then
  bun_executable="${HOME}/.bun/bin/bun"
else
  printf '%s\n' "Bun is required to install the account recorder." >&2
  exit 69
fi

mkdir -p "$bin_directory" "$install_root" "$state_root"
if [ -L "$state_root" ] || [ ! -d "$state_root" ]; then
  printf '%s\n' "Account recorder state path is unsafe." >&2
  exit 65
fi
chmod 0700 "$state_root"

source_candidate=$(mktemp "${install_root}/.record-codex-account.XXXXXX")
wrapper_candidate=$(mktemp "${bin_directory}/.aicharts-record-codex-account.XXXXXX")
cleanup() {
  rm -f -- "$source_candidate" "$wrapper_candidate"
}
trap cleanup EXIT HUP INT TERM

install -m 0500 "$source_path" "$source_candidate"
set +e
"$bun_executable" "$source_candidate" unexpected-argument >/dev/null 2>&1
validation_status=$?
set -e
if [ "$validation_status" -ne 64 ]; then
  printf '%s\n' "Installed account recorder source failed its invocation check." >&2
  exit 65
fi

escaped_bun=$(printf '%s' "$bun_executable" | sed "s/'/'\\\\''/g")
escaped_source=$(printf '%s' "$installed_source" | sed "s/'/'\\\\''/g")
{
  printf '%s\n' '#!/bin/sh' 'set -eu'
  printf "exec '%s' '%s' \"\$@\"\n" "$escaped_bun" "$escaped_source"
} > "$wrapper_candidate"
chmod 0500 "$wrapper_candidate"

mv -f -- "$source_candidate" "$installed_source"
mv -f -- "$wrapper_candidate" "$bin_path"
trap - EXIT HUP INT TERM
printf '%s\n' "Installed ${bin_path}."
