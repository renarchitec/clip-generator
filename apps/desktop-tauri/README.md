# DartClip Desktop

DartClip Desktop uses Tauri v2 and embeds the Rust local API. No separate server or desktop npm package is needed. It stores data and clips in `~/DartClip` by default; set `DARTCLIP_DATA_DIR` to override that location. DartClip checks the data directory’s `bin` folder first for `ffmpeg`, `ffprobe`, and `yt-dlp`, then Homebrew’s standard locations on macOS and the inherited `PATH`.

Install Rust (stable), Node.js and pnpm, and install the repository’s JavaScript dependencies from the root. Build the SPA with `pnpm --filter web build:desktop` from the root before invoking Tauri directly. Rebuild the SPA after frontend changes.

## Public Releases & Auto-Updates

Download the latest public installers for macOS (Apple Silicon and Intel) and Windows (64-bit) at [GitHub Releases](https://github.com/renarchitec/clip-generator/releases/latest).

To publish from the commit you want to release, push a desktop version tag:

```sh
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
```

You can also run **Release Desktop App** manually from the repository's **Actions** tab (`workflow_dispatch`). Leave the tag blank to use the version in `tauri.conf.json`, or supply a tag and optionally mark the release as a draft or pre-release. The updater checks [`latest.json`](https://github.com/renarchitec/clip-generator/releases/latest/download/latest.json) on the latest public stable release, not drafts or pre-releases.

The workflow signs updater artifacts with the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret. If that key has a password, set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as well. For optional Apple Developer signing and notarization, configure `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`.

## macOS

Install the Xcode command-line tools (`xcode-select --install`). From the repository root:

```sh
./apps/desktop-tauri/build-macos.sh
```

The script builds the SPA if missing and prints the `.app` and `.dmg` paths and sizes. Open `DartClip.app` directly, or open the DMG and copy the app into Applications. Local builds are not notarized.

## Windows

Install the MSVC Rust toolchain, Visual Studio Build Tools with the C++ desktop workload and Windows SDK, and the Microsoft Edge WebView2 runtime. Use PowerShell from the repository root:

```powershell
$env:PATH = "${HOME}/.cargo/bin;$env:PATH"
pnpm --filter web build:desktop
Set-Location apps/desktop-tauri/src-tauri
pnpm dlx @tauri-apps/cli@2 build --bundles nsis
```

Run the setup executable printed by Tauri (normally under `target/release/bundle/nsis`). Alternatively, launch the locally built `target/release/dartclip.exe`.
