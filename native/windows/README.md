# SotoWinNative

`native/windows` is the .NET 8 Native AOT project that builds
`SotoWinNative.dll` for the Windows native bridge loaded by
`@soto/native-bridge`.

## Prerequisites

- Windows 10+ x64 or Windows 11 x64.
- .NET 8 SDK with Native AOT support.
- Visual Studio Build Tools with the C++ workload.

`win-arm64` output and signtool signing are intentionally deferred for the
first native-platform rewrite.

## Development

The normal entry point is the .NET Native AOT project. Build the publish output
before packaging Electron; the intermediate DLL one directory above `publish/`
is a managed assembly and does not expose the `soto_win_*` C ABI.

```powershell
dotnet publish native/windows/SotoWinNative.csproj -c Release -r win-x64 --self-contained -p:PublishAot=true
```

To check the C# project without publishing:

```powershell
dotnet build native/windows/SotoWinNative.csproj -c Release
```

Generated `bin/` and `obj/` directories are build outputs and should not be
committed.

When changing `InjectionBridge.cs`, smoke-test `soto_win_focus_probe`,
`soto_win_type_text_chunk`, `soto_win_native_insert_text`,
`soto_win_send_copy`, and `soto_win_send_paste` against a safe foreground
target such as Notepad.
Insert/type/copy/paste exports should return `0`. `soto_win_send_paste`
intentionally only posts Ctrl+V; focus/protection checks live in the Electron
main injector's async probe, not in the paste export. Useful failure codes for
manual smoke logs:

- `1`: unsupported selection behavior for `soto_win_native_insert_text`.
- `-1`: invalid argument, such as a null UTF-8 pointer.
- `-2`: incomplete Unicode `SendInput` for direct insert/type.
- `-6`: no focused element for UIA-preflighted exports.
- `-10`: incomplete paste/copy chord `SendInput`.
- `-11`: foreground integrity blocks access for UIA-preflighted exports.
- `-12`: UIA password field.
- `-100`: unhandled native exception.

When changing `ClipboardBridge.cs`, smoke-test
`soto_win_clipboard_snapshot_kind`, `soto_win_clipboard_set_excluded`, and
`soto_win_clipboard_change_count`. The excluded write should not add transient
payloads to Win+V/cloud clipboard history on hosts that honor the registered
exclusion formats.

## Packaging

Use the root package smoke on a Windows x64 host:

```powershell
pnpm smoke:package:win
```

It builds the Native AOT DLL, packages the Electron app, and verifies the
published and packaged DLL exports. If you need to run the steps manually, build
the Native AOT DLL first, then package the Electron app:

```powershell
dotnet publish native/windows/SotoWinNative.csproj -c Release -r win-x64 --self-contained -p:PublishAot=true
pnpm --filter @soto/desktop package
pnpm smoke:package:win --verify-only
```

Electron Builder copies
`native/windows/bin/Release/net8.0/win-x64/publish/SotoWinNative.dll` to
`resources/native/SotoWinNative.dll`. The koffi bridge resolves that packaged
path through `process.resourcesPath`.

Useful packaging checks:

```powershell
$dlls = @(Get-ChildItem apps/desktop/dist -Recurse -Filter SotoWinNative.dll | Where-Object { $_.FullName -match "\\resources\\native\\" })
$exes = @(Get-ChildItem apps/desktop/dist -Recurse -Filter "*.exe")
if ($dlls.Count -eq 0) { throw "SotoWinNative.dll was not found under packaged resources/native" }
if ($exes.Count -eq 0) { throw "No packaged Windows executable was found" }
$dlls | Format-List
```

Run the manual E2E smoke on a clean Windows machine that does not have the .NET
SDK installed before treating release packaging as complete.
