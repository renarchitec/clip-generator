#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"

cd -- "$(dirname -- "$0")/../.."
if [[ ! -f apps/web/dist-desktop/index.html ]]; then
  pnpm --filter web build:desktop
fi
cd apps/desktop-tauri/src-tauri
pnpm dlx @tauri-apps/cli@2 build --bundles app,dmg

# Cargo may use a custom target directory. Tauri uses the host target by default.
target_dir=$(cargo metadata --no-deps --format-version 1 | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).target_directory')
bundle_dir="$target_dir/release/bundle"
if [[ -n "${CARGO_BUILD_TARGET:-}" ]]; then
  bundle_dir="$target_dir/$CARGO_BUILD_TARGET/release/bundle"
fi
du -sh "$bundle_dir/macos/DartClip.app"
ls -lh "$bundle_dir"/dmg/DartClip_*.dmg
