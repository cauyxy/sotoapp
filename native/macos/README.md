# SotoMacNative

`native/macos` is the SwiftPM package that builds `libSotoMacNative.dylib`
for the Electron main-process koffi bridge.

## Prerequisites

- macOS 14+ on Apple Silicon.
- Xcode 16+ or Command Line Tools with Swift 6 available on `PATH`.
- pnpm for the Electron workspace commands.

## Development

The release script invokes SwiftPM directly before running Electron Builder:

```bash
swift build --package-path native/macos -c release
```

## Packaging

Use the root Electron release wrapper:

```bash
pnpm build:mac:signed
```

The wrapper builds this Swift package, then Electron Builder copies
`native/macos/.build/arm64-apple-macosx/release/libSotoMacNative.dylib` to
`Soto.app/Contents/Resources/native/libSotoMacNative.dylib`.

Useful packaging checks:

```bash
find apps/desktop/dist -path "*/Soto.app/Contents/Resources/native/libSotoMacNative.dylib"
lipo -info apps/desktop/dist/mac-arm64/Soto.app/Contents/Resources/native/libSotoMacNative.dylib
nm -gU apps/desktop/dist/mac-arm64/Soto.app/Contents/Resources/native/libSotoMacNative.dylib | rg "soto_"
```

Signed release builds use `pnpm build:mac:signed` with the private files under
`signing-secrets/`. The signed build also emits Electron Builder feed metadata
such as `apps/desktop/dist/latest-mac.yml`, which the repo's packaging checks
verify.
