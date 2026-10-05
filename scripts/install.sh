#!/bin/sh
# Install the aicharts command on macOS (Apple silicon) or Linux (x86_64).
#
#   curl -fsSL https://aicharts.io/install.sh | sh
#
# Downloads the aicharts release archive from GitHub, checks it against the
# SHA-256 digest pinned below and, on macOS, its Apple Developer ID signature,
# then installs ~/.local/bin/aicharts. Nothing runs as root.
#
# On a first install it turns on local usage history: aicharts reads your
# coding agents' session files four times a day and keeps daily token totals
# on this computer. Nothing is uploaded. Publishing to aicharts.io is a
# separate choice you make later with `aicharts publish enable`.
#
# A first install also turns on daily self-updates: once a day aicharts
# checks GitHub for a newer release, verifies the archive's SHA-256 against
# the digest the release published and, on macOS, its Apple Developer ID
# signature, then replaces only itself. It downloads releases; it never
# uploads anything.
#
# Options (environment):
#   AICHARTS_INSTALL_DIR=DIR     install into DIR (default: ~/.local/bin)
#   AICHARTS_USAGE_HISTORY=no    install, but leave usage history off
#   AICHARTS_AUTO_UPDATE=no      install, but leave daily updates off
# Source: https://github.com/hraness/aicharts/blob/main/scripts/install.sh
#
# Everything is inside main(), so a partial download runs nothing.

# The release this installer adds, with its reviewed archive digests.
AICHARTS_VERSION=0.3.1
AICHARTS_SHA256_DARWIN_AARCH64=e79a19b0b174845c939e2472b4dbf3e5738b6bf867bd16aba2daa86be6f049b6
AICHARTS_SHA256_LINUX_X86_64=c2a8acf56019565668bbcf84884503428d857ab5c54fecec85ae145644f83559

main() {
  set -eu
  source_help="build from source instead: cargo install --locked --git https://github.com/hraness/aicharts aicharts-cli"
  case "$(uname -s) $(uname -m)" in
    "Darwin arm64") target=aarch64-apple-darwin expected=$AICHARTS_SHA256_DARWIN_AARCH64 ;;
    "Linux x86_64") target=x86_64-unknown-linux-gnu expected=$AICHARTS_SHA256_LINUX_X86_64 ;;
    *) fail "no aicharts release for $(uname -s) $(uname -m) yet; $source_help" ;;
  esac
  base="https://github.com/hraness/aicharts/releases/download/cli-v$AICHARTS_VERSION"
  # Tests serve a stand-in release from a loopback address.
  if [ -n "${AICHARTS_INSTALL_BASE_URL:-}" ]; then
    printf '%s\n' "$AICHARTS_INSTALL_BASE_URL" | LC_ALL=C grep -Eq '^http://127\.0\.0\.1:[0-9]{1,5}$' \
      || fail "AICHARTS_INSTALL_BASE_URL may only name a loopback test server"
    base=$AICHARTS_INSTALL_BASE_URL
    expected=${AICHARTS_INSTALL_SHA256:-$expected}
  fi
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  bin=${AICHARTS_INSTALL_DIR:-$HOME/.local/bin}
  case "$bin" in /*) ;; *) fail "AICHARTS_INSTALL_DIR must be an absolute path" ;; esac
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  command -v tar >/dev/null 2>&1 || fail "tar is required"
  if [ "$target" = aarch64-apple-darwin ] && [ ! -x /usr/bin/codesign ]; then
    fail "macOS codesign is required to check the aicharts signature"
  fi

  temporary=$(mktemp -d "${TMPDIR:-/tmp}/aicharts-install.XXXXXX")
  trap 'rm -rf "$temporary"' EXIT INT TERM

  root="aicharts-$AICHARTS_VERSION-$target"
  asset="$root.tar.gz"
  echo "Installing aicharts $AICHARTS_VERSION for $(uname -s) $(uname -m)"
  download "$base/$asset" "$temporary/$asset" || fail "could not download $asset"
  actual=$(sha256 "$temporary/$asset")
  [ "$actual" = "$expected" ] || fail "checksum mismatch for $asset (expected $expected, got $actual)"
  mkdir "$temporary/x"
  tar -xzf "$temporary/$asset" -C "$temporary/x" "$root/bin/aicharts" 2>/dev/null \
    || fail "$asset has no bin/aicharts"
  candidate="$temporary/x/$root/bin/aicharts"
  [ -f "$candidate" ] && [ ! -L "$candidate" ] || fail "$asset must contain a regular bin/aicharts"
  if [ "$target" = aarch64-apple-darwin ] && ! macos_signature_ok "$candidate"; then
    fail "aicharts does not have the required Apple Developer ID signature"
  fi
  chmod 0755 "$candidate"
  case "$(HRANESS_SUPPORT_AUDIENCE=off "$candidate" --version 2>/dev/null)" in
    "aicharts $AICHARTS_VERSION" | "aicharts $AICHARTS_VERSION "*) ;;
    *) fail "the downloaded aicharts does not report version $AICHARTS_VERSION" ;;
  esac

  mkdir -p "$bin"
  installed="$bin/aicharts"
  [ ! -L "$installed" ] || fail "$installed is a symlink; remove it or set AICHARTS_INSTALL_DIR"
  first_install=yes
  [ ! -e "$installed" ] || first_install=no
  cp "$candidate" "$bin/.aicharts-install.$$"
  chmod 0755 "$bin/.aicharts-install.$$"
  mv -f "$bin/.aicharts-install.$$" "$installed"
  echo "Installed $installed ($actual)"
  HRANESS_SUPPORT_AUDIENCE=off "$installed" --version

  if [ "$first_install" = yes ]; then
    case "${AICHARTS_USAGE_HISTORY:-yes}" in
      no | 0 | false | off) echo "Local usage history is off. Turn it on with: aicharts history enable" ;;
      *) turn_on_history "$installed" ;;
    esac
    case "${AICHARTS_AUTO_UPDATE:-yes}" in
      no | 0 | false | off) echo "Daily updates are off. Turn them on with: aicharts update enable" ;;
      *) turn_on_updates "$installed" ;;
    esac
  fi
  case ":${PATH:-}:" in
    *":$bin:"*) ;;
    *) printf '%s is not on PATH. Add it with:\n  export PATH="%s:$PATH"\n' "$bin" "$bin" ;;
  esac
  echo
  echo "Next: aicharts history report    (your token use by day, agent and model)"
  echo "Guide: https://aicharts.io/usage"
}

# turn_on_history AICHARTS starts the local collector unless it already runs.
turn_on_history() {
  status=$(HRANESS_SUPPORT_AUDIENCE=off "$1" history status --json 2>/dev/null) || status=
  case "$status" in *'"collecting":"off"'* | "") ;; *) return 0 ;; esac
  if HRANESS_SUPPORT_AUDIENCE=off "$1" history enable >/dev/null 2>&1; then
    echo "Local usage history is on: aicharts records your agents' daily token totals"
    echo "on this computer four times a day. Nothing is uploaded."
    echo "  Turn off:  aicharts history disable"
  else
    warn "could not turn on local usage history; run: aicharts history enable"
  fi
}

# turn_on_updates AICHARTS starts the daily update check unless it already runs.
turn_on_updates() {
  status=$(HRANESS_SUPPORT_AUDIENCE=off "$1" update status --json 2>/dev/null) || status=
  case "$status" in *'"scheduler":"on"'* | *'"scheduler":"not-ours"'* | *'"scheduler":"unsupported"'*) return 0 ;; esac
  if HRANESS_SUPPORT_AUDIENCE=off "$1" update enable >/dev/null 2>&1; then
    echo "Daily updates are on: aicharts checks GitHub once a day and installs"
    echo "a new release only after verifying it. Nothing is uploaded."
    echo "  Turn off:  aicharts update disable"
  else
    warn "could not turn on daily updates; run: aicharts update enable"
  fi
}

# macos_signature_ok BINARY checks the Hraness Developer ID signature, offline.
macos_signature_ok() {
  requirement='anchor apple generic and identifier "dev.hraness.aicharts" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "8AAP53VTW3"'
  /usr/bin/codesign --verify --strict --all-architectures --test-requirement "=$requirement" "$1"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

download() {
  case "$1" in
    https://*) curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 -o "$2" "$1" ;;
    *) curl -fsSL --connect-timeout 15 --max-time 300 -o "$2" "$1" ;;
  esac
}

warn() {
  printf 'aicharts install: %s\n' "$*" >&2
}

fail() {
  warn "$*"
  exit 1
}

main "$@"
