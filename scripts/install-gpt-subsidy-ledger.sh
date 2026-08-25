#!/usr/bin/env bash
set -euo pipefail

TOKSCALE_VERSION="4.13.0"
TOKSCALE_COMMIT="0149a44329fb89865837dde40adb8cd9bc06bead"
TOKSCALE_REMOTE="https://github.com/junhoyeo/tokscale.git"
EXAMPLE_NAME="aicharts_gpt_subsidy_ledger"

SCRIPT_DIRECTORY="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_PATH="$SCRIPT_DIRECTORY/$EXAMPLE_NAME.rs"
UPDATER_PATH="$SCRIPT_DIRECTORY/update-gpt-subsidy.ts"
SHARED_CONTRACT_PATH="$SCRIPT_DIRECTORY/../lib/gpt-subsidy-manifests.ts"
PRICING_MANIFEST_PATH="$SCRIPT_DIRECTORY/../data/gpt-subsidy-pricing.json"
MEASUREMENT_MANIFEST_PATH="$SCRIPT_DIRECTORY/../data/gpt-subsidy-measurement.json"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_ROOT="${AICHARTS_GPT_SUBSIDY_INSTALL_ROOT:-$DATA_HOME/aicharts/gpt-subsidy-ledger}"
CHECKOUT_PATH="$INSTALL_ROOT/tokscale-$TOKSCALE_COMMIT"
BIN_DIRECTORY="$HOME/.local/bin"
BIN_PATH="$BIN_DIRECTORY/aicharts-gpt-subsidy-ledger"
EXAMPLE_RELATIVE_PATH="crates/tokscale-core/examples/$EXAMPLE_NAME.rs"
EMBEDDED_MANIFEST_RELATIVE_PATH="crates/tokscale-core/data/gpt-subsidy-pricing.json"
EMBEDDED_MEASUREMENT_RELATIVE_PATH="crates/tokscale-core/data/gpt-subsidy-measurement.json"
EXAMPLE_PATH="$CHECKOUT_PATH/$EXAMPLE_RELATIVE_PATH"
EMBEDDED_MANIFEST_PATH="$CHECKOUT_PATH/$EMBEDDED_MANIFEST_RELATIVE_PATH"
EMBEDDED_MEASUREMENT_PATH="$CHECKOUT_PATH/$EMBEDDED_MEASUREMENT_RELATIVE_PATH"

for command_name in git cargo install cmp mktemp mv awk shasum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s\n' "Required command is unavailable: $command_name" >&2
    exit 1
  fi
done

measurement_source_sha256() {
  local manifest_key="$1"
  local manifest_path="${2:-$MEASUREMENT_MANIFEST_PATH}"
  awk -v manifest_key="\"$manifest_key\"" '
  index($0, manifest_key) && /:[[:space:]]*{/ { in_implementation_file = 1; next }
  in_implementation_file && /"sha256"[[:space:]]*:/ {
    value = $0
    sub(/^[^:]*:[[:space:]]*"/, "", value)
    sub(/"[[:space:]]*,?[[:space:]]*$/, "", value)
    print value
    exit
  }
  ' "$manifest_path"
}

verify_measurement_source() {
  local manifest_key="$1"
  local source_label="$2"
  local source_path="$3"
  local manifest_path="${4:-$MEASUREMENT_MANIFEST_PATH}"
  local expected_sha256
  local actual_sha256
  expected_sha256=$(measurement_source_sha256 "$manifest_key" "$manifest_path")
  actual_sha256=$(shasum -a 256 "$source_path" | awk '{ print $1 }')
  if [ -z "$expected_sha256" ] || [ "$actual_sha256" != "$expected_sha256" ]; then
    printf '%s\n' \
      "$source_label bytes do not match measurement manifest identity; refusing to build." >&2
    exit 1
  fi
}

verify_measurement_source "ledgerAdapter" "Ledger adapter" "$SOURCE_PATH"
verify_measurement_source "publicUpdater" "Public updater" "$UPDATER_PATH"
verify_measurement_source "sharedContract" "Shared subsidy contract" "$SHARED_CONTRACT_PATH"

mkdir -p "$INSTALL_ROOT" "$BIN_DIRECTORY"

TARGET_PATH=$(mktemp -d "$INSTALL_ROOT/target-$TOKSCALE_COMMIT.XXXXXX")
INSTALL_CANDIDATE=""
CHECKOUT_ARTIFACTS_OWNED=0
VERIFIED_INPUTS_PATH="$TARGET_PATH/verified-inputs"
VERIFIED_SOURCE_PATH="$VERIFIED_INPUTS_PATH/$EXAMPLE_NAME.rs"
VERIFIED_UPDATER_PATH="$VERIFIED_INPUTS_PATH/update-gpt-subsidy.ts"
VERIFIED_SHARED_CONTRACT_PATH="$VERIFIED_INPUTS_PATH/gpt-subsidy-manifests.ts"
VERIFIED_PRICING_MANIFEST_PATH="$VERIFIED_INPUTS_PATH/gpt-subsidy-pricing.json"
VERIFIED_MEASUREMENT_MANIFEST_PATH="$VERIFIED_INPUTS_PATH/gpt-subsidy-measurement.json"

cleanup_installer_state() {
  if [ "$CHECKOUT_ARTIFACTS_OWNED" = "1" ]; then
    rm -f -- "$EXAMPLE_PATH" "$EMBEDDED_MANIFEST_PATH" "$EMBEDDED_MEASUREMENT_PATH"
  fi
  if [ -n "$INSTALL_CANDIDATE" ]; then
    rm -f -- "$INSTALL_CANDIDATE"
  fi
  case "$TARGET_PATH" in
    "$INSTALL_ROOT"/target-"$TOKSCALE_COMMIT".*)
      rm -rf -- "$TARGET_PATH"
      ;;
    *)
      printf '%s\n' "Refusing to remove unexpected target path $TARGET_PATH." >&2
      ;;
  esac
}
trap cleanup_installer_state EXIT

# Snapshot every verified build and measurement input before any clone, fetch,
# or compile work. Later repository edits can therefore only abort the install;
# they cannot change the bytes compiled under the snapshotted manifest identity.
mkdir -p "$VERIFIED_INPUTS_PATH"
install -m 0444 "$SOURCE_PATH" "$VERIFIED_SOURCE_PATH"
install -m 0444 "$UPDATER_PATH" "$VERIFIED_UPDATER_PATH"
install -m 0444 "$SHARED_CONTRACT_PATH" "$VERIFIED_SHARED_CONTRACT_PATH"
install -m 0444 "$PRICING_MANIFEST_PATH" "$VERIFIED_PRICING_MANIFEST_PATH"
install -m 0444 "$MEASUREMENT_MANIFEST_PATH" "$VERIFIED_MEASUREMENT_MANIFEST_PATH"

verify_measurement_source \
  "ledgerAdapter" "Snapshotted ledger adapter" "$VERIFIED_SOURCE_PATH" \
  "$VERIFIED_MEASUREMENT_MANIFEST_PATH"
verify_measurement_source \
  "publicUpdater" "Snapshotted public updater" "$VERIFIED_UPDATER_PATH" \
  "$VERIFIED_MEASUREMENT_MANIFEST_PATH"
verify_measurement_source \
  "sharedContract" "Snapshotted shared subsidy contract" \
  "$VERIFIED_SHARED_CONTRACT_PATH" "$VERIFIED_MEASUREMENT_MANIFEST_PATH"

verify_current_inputs_match_snapshot() {
  verify_measurement_source \
    "ledgerAdapter" "Ledger adapter" "$SOURCE_PATH" \
    "$VERIFIED_MEASUREMENT_MANIFEST_PATH"
  verify_measurement_source \
    "publicUpdater" "Public updater" "$UPDATER_PATH" \
    "$VERIFIED_MEASUREMENT_MANIFEST_PATH"
  verify_measurement_source \
    "sharedContract" "Shared subsidy contract" "$SHARED_CONTRACT_PATH" \
    "$VERIFIED_MEASUREMENT_MANIFEST_PATH"
  if ! cmp -s "$PRICING_MANIFEST_PATH" "$VERIFIED_PRICING_MANIFEST_PATH"; then
    printf '%s\n' \
      "Pricing manifest changed during installation; refusing to install." >&2
    exit 1
  fi
  if ! cmp -s "$MEASUREMENT_MANIFEST_PATH" "$VERIFIED_MEASUREMENT_MANIFEST_PATH"; then
    printf '%s\n' \
      "Measurement manifest changed during installation; refusing to install." >&2
    exit 1
  fi
}

verify_current_inputs_match_snapshot

if [ ! -d "$CHECKOUT_PATH/.git" ]; then
  git -c core.hooksPath=/dev/null clone --filter=blob:none "$TOKSCALE_REMOTE" "$CHECKOUT_PATH"
fi

if [ "$(git -C "$CHECKOUT_PATH" remote get-url origin)" != "$TOKSCALE_REMOTE" ]; then
  printf '%s\n' "Refusing to use a Tokscale checkout with an unexpected origin." >&2
  exit 1
fi
if ! git -C "$CHECKOUT_PATH" diff --quiet || ! git -C "$CHECKOUT_PATH" diff --cached --quiet; then
  printf '%s\n' "Refusing to replace tracked changes in $CHECKOUT_PATH." >&2
  exit 1
fi
CHECKOUT_ARTIFACTS_OWNED=1

# Remove only artifacts this installer owns from a prior interrupted run, then
# reject every other untracked or ignored file. In particular, Cargo must never
# see an injected build.rs or .cargo/config.toml in this pinned checkout.
rm -f -- "$EXAMPLE_PATH" "$EMBEDDED_MANIFEST_PATH" "$EMBEDDED_MEASUREMENT_PATH"
unexpected_checkout_files=$(git -C "$CHECKOUT_PATH" \
  status --porcelain=v1 --untracked-files=all --ignored)
if [ -n "$unexpected_checkout_files" ]; then
  printf '%s\n' "Refusing untracked or ignored files in the Tokscale checkout:" >&2
  printf '%s\n' "$unexpected_checkout_files" >&2
  exit 1
fi

if [ ! -f "$CHECKOUT_PATH/Cargo.toml" ]; then
  # Recover only an interrupted checkout created by this installer's former
  # no-checkout clone path after all local content has passed the checks above.
  git -c core.hooksPath=/dev/null \
    -C "$CHECKOUT_PATH" fetch --depth=1 origin "$TOKSCALE_COMMIT"
  git -c core.hooksPath=/dev/null \
    -C "$CHECKOUT_PATH" checkout --force --detach "$TOKSCALE_COMMIT"
fi

git -c core.hooksPath=/dev/null \
  -C "$CHECKOUT_PATH" fetch --depth=1 origin "$TOKSCALE_COMMIT"
git -c core.hooksPath=/dev/null \
  -C "$CHECKOUT_PATH" checkout --detach "$TOKSCALE_COMMIT"
if [ -n "$(git -C "$CHECKOUT_PATH" status --porcelain=v1 --untracked-files=all --ignored)" ]; then
  printf '%s\n' "Pinned Tokscale checkout is not clean after checkout." >&2
  exit 1
fi
if [ "$(git -C "$CHECKOUT_PATH" rev-parse HEAD)" != "$TOKSCALE_COMMIT" ]; then
  printf '%s\n' "Pinned Tokscale commit verification failed." >&2
  exit 1
fi
if [ "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$CHECKOUT_PATH/Cargo.toml" | head -n 1)" != "$TOKSCALE_VERSION" ]; then
  printf '%s\n' "Pinned Tokscale version verification failed." >&2
  exit 1
fi

mkdir -p "$(dirname -- "$EXAMPLE_PATH")" "$(dirname -- "$EMBEDDED_MANIFEST_PATH")"
verify_current_inputs_match_snapshot
install -m 0644 "$VERIFIED_SOURCE_PATH" "$EXAMPLE_PATH"
install -m 0644 "$VERIFIED_PRICING_MANIFEST_PATH" "$EMBEDDED_MANIFEST_PATH"
install -m 0644 "$VERIFIED_MEASUREMENT_MANIFEST_PATH" "$EMBEDDED_MEASUREMENT_PATH"
verify_measurement_source \
  "ledgerAdapter" "Injected ledger adapter" "$EXAMPLE_PATH" \
  "$VERIFIED_MEASUREMENT_MANIFEST_PATH"
if ! cmp -s "$VERIFIED_PRICING_MANIFEST_PATH" "$EMBEDDED_MANIFEST_PATH"; then
  printf '%s\n' "Embedded pricing manifest copy verification failed." >&2
  exit 1
fi
if ! cmp -s "$VERIFIED_MEASUREMENT_MANIFEST_PATH" "$EMBEDDED_MEASUREMENT_PATH"; then
  printf '%s\n' "Embedded measurement manifest copy verification failed." >&2
  exit 1
fi

CARGO_TARGET_DIR="$TARGET_PATH" cargo test \
  --locked \
  --manifest-path "$CHECKOUT_PATH/Cargo.toml" \
  --package tokscale-core \
  --example "$EXAMPLE_NAME"
CARGO_TARGET_DIR="$TARGET_PATH" cargo build \
  --locked \
  --release \
  --manifest-path "$CHECKOUT_PATH/Cargo.toml" \
  --package tokscale-core \
  --example "$EXAMPLE_NAME"

verify_measurement_source \
  "ledgerAdapter" "Injected ledger adapter" "$EXAMPLE_PATH" \
  "$VERIFIED_MEASUREMENT_MANIFEST_PATH"
if ! cmp -s "$VERIFIED_PRICING_MANIFEST_PATH" "$EMBEDDED_MANIFEST_PATH"; then
  printf '%s\n' "Embedded pricing manifest changed during the adapter build." >&2
  exit 1
fi
if ! cmp -s "$VERIFIED_MEASUREMENT_MANIFEST_PATH" "$EMBEDDED_MEASUREMENT_PATH"; then
  printf '%s\n' "Embedded measurement manifest changed during the adapter build." >&2
  exit 1
fi

rm -f -- "$EXAMPLE_PATH" "$EMBEDDED_MANIFEST_PATH" "$EMBEDDED_MEASUREMENT_PATH"
if [ -n "$(git -C "$CHECKOUT_PATH" status --porcelain=v1 --untracked-files=all --ignored)" ]; then
  printf '%s\n' "Tokscale checkout was contaminated during the adapter build." >&2
  exit 1
fi

INSTALL_CANDIDATE=$(mktemp "$BIN_DIRECTORY/.aicharts-gpt-subsidy-ledger.XXXXXX")
install -m 0755 "$TARGET_PATH/release/examples/$EXAMPLE_NAME" "$INSTALL_CANDIDATE"

# Pricing is embedded from the checked AI Charts manifest during compilation.
# Tokscale is invoked without a PricingService and is used only for session
# parsing, incremental source caching, and global fork/replay deduplication.
TOKSCALE_CONFIG_DIRECTORY="$INSTALL_ROOT/tokscale-config"
if [ -e "$TOKSCALE_CONFIG_DIRECTORY/custom-pricing.json" ]; then
  printf '%s\n' "Refusing mutable Tokscale custom pricing in the dedicated adapter profile." >&2
  exit 1
fi
TOKSCALE_CONFIG_DIR="$TOKSCALE_CONFIG_DIRECTORY" "$INSTALL_CANDIDATE" --warm-source-cache

if [ -n "$(git -C "$CHECKOUT_PATH" status --porcelain=v1 --untracked-files=all --ignored)" ]; then
  printf '%s\n' "Tokscale checkout changed while warming the adapter cache." >&2
  exit 1
fi

# The updater and shared contract are not compiler inputs, but their hashes are
# part of the same public measurement revision. Re-check every current source
# and manifest immediately before the candidate replaces the trusted binary.
verify_current_inputs_match_snapshot
mv -f -- "$INSTALL_CANDIDATE" "$BIN_PATH"
INSTALL_CANDIDATE=""
printf '%s\n' "Installed $BIN_PATH from Tokscale $TOKSCALE_VERSION ($TOKSCALE_COMMIT)."
