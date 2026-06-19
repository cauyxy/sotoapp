using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace SotoWinNative;

public static class PermissionsExports
{
    private const int PaneMicrophone = 0;
    private const int PaneAccessibility = 1;
    private const int PaneScreenRecording = 2;
    private const int PaneAutomation = 3;
    private const int StatusNotRequired = 5;
    private const int StatusUnknown = 6;

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_permission_status_kind",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int PermissionStatusKind(int pane)
    {
        return StatusKindFor(pane);
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_request_permission",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int RequestPermission(int pane)
    {
        string? uri = pane switch
        {
            PaneMicrophone => "ms-settings:privacy-microphone",
            PaneAccessibility => "ms-settings:easeofaccess-keyboard",
            PaneScreenRecording => "ms-settings:privacy-graphicsCaptureProgrammatic",
            PaneAutomation => "ms-settings:privacy",
            _ => null,
        };
        if (uri is null)
        {
            return -1;
        }

        try
        {
            _ = Process.Start(new ProcessStartInfo(uri)
            {
                UseShellExecute = true,
            });
            return StatusKindFor(pane);
        }
        catch
        {
            return -100;
        }
    }

    private static int StatusKindFor(int pane) => pane switch
    {
        // Windows exposes no queryable per-app microphone grant for an
        // unpackaged desktop (Electron) app: the global "let desktop apps access
        // your microphone" toggle has no per-app ConsentStore entry we can read.
        // Real denial surfaces at capture time when getUserMedia throws (renderer
        // MicPermissionError) — the same "getUserMedia drives the real grant"
        // contract the macOS gate documents. Report NotRequired (like the two
        // panes below) rather than Unknown; Unknown was mapped to granted=false
        // and readiness turned it into a permanent false "microphone denied"
        // blocker on Home. Defense-in-depth: readiness also no longer blocks on
        // "unknown" (core permissionBlocks), so both layers guard this.
        PaneMicrophone => StatusNotRequired,
        PaneAccessibility => StatusNotRequired,
        PaneScreenRecording => StatusNotRequired,
        PaneAutomation => StatusNotRequired,
        _ => StatusUnknown,
    };
}
