using System;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace SotoWinNative;

/// <summary>
/// Converts native physical-pixel rectangles into the Electron screen DIP,
/// top-left-origin string contract shared with macOS (`electronRectString`):
/// "x,y,width,height". UIA `GetBoundingRectangles` and `GetWindowRect` both
/// report PHYSICAL pixels; Electron's screen API works in DIP. We divide by the
/// effective per-monitor scale so the native-bridge contract stays uniform
/// across platforms (main/core never see platform coordinate differences).
///
/// VERIFICATION PENDING (no Windows device locally): per-monitor uniform
/// division is exact for a single monitor at any scale and for uniform-scale
/// multi-monitor. MIXED-DPI multi-monitor can be off, because absolute DIP
/// layout is not a simple per-point division there. If verification shows
/// drift on mixed-DPI setups, the escape hatch is to return physical pixels
/// here and convert with Electron `screen.screenToDipRect(win, rect)` in main.
/// </summary>
internal static class DisplayMetrics
{
    private const uint MonitorDefaultToNearest = 2;
    private const int MdtEffectiveDpi = 0;
    private const double DefaultDpi = 96.0;

    public static unsafe bool SupportsReliableDipConversion()
    {
        var state = new DpiEnumerationState
        {
            Uniform = 1,
        };

        int result = User32.EnumDisplayMonitors(
            0,
            null,
            &RecordMonitorDpi,
            (nint)(&state));
        return result != 0 && state.Count > 0 && state.Uniform != 0;
    }

    public static string PhysicalRectToDipString(
        double left,
        double top,
        double width,
        double height)
    {
        var rect = PhysicalRectToDip(left, top, width, height);
        return string.Concat(
            rect.X.ToString(CultureInfo.InvariantCulture),
            ",",
            rect.Y.ToString(CultureInfo.InvariantCulture),
            ",",
            rect.Width.ToString(CultureInfo.InvariantCulture),
            ",",
            rect.Height.ToString(CultureInfo.InvariantCulture));
    }

    public static DipRect PhysicalRectToDip(
        double left,
        double top,
        double width,
        double height)
    {
        double scale = ScaleForPoint(left + (width / 2.0), top + (height / 2.0));
        if (scale <= 0)
        {
            scale = 1.0;
        }

        return new DipRect(left / scale, top / scale, width / scale, height / scale);
    }

    private static double ScaleForPoint(double x, double y)
    {
        POINT point = new()
        {
            X = (int)Math.Round(x),
            Y = (int)Math.Round(y),
        };

        nint monitor = User32.MonitorFromPoint(point, MonitorDefaultToNearest);
        if (monitor == 0)
        {
            return 1.0;
        }

        int hr = Shcore.GetDpiForMonitor(monitor, MdtEffectiveDpi, out uint dpiX, out uint _);
        if (hr < 0 || dpiX == 0)
        {
            return 1.0;
        }

        return dpiX / DefaultDpi;
    }

    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvStdcall) })]
    private static unsafe int RecordMonitorDpi(
        nint monitor,
        nint hdc,
        RECT* rect,
        nint data)
    {
        _ = hdc;
        _ = rect;
        if (monitor == 0 || data == 0)
        {
            return 0;
        }

        var state = (DpiEnumerationState*)data;
        int hr = Shcore.GetDpiForMonitor(monitor, MdtEffectiveDpi, out uint dpiX, out uint dpiY);
        if (hr < 0 || dpiX == 0 || dpiY == 0)
        {
            state->Uniform = 0;
            return 0;
        }

        if (state->HasFirst == 0)
        {
            state->FirstDpiX = dpiX;
            state->FirstDpiY = dpiY;
            state->HasFirst = 1;
        }
        else if (dpiX != state->FirstDpiX || dpiY != state->FirstDpiY)
        {
            state->Uniform = 0;
            return 0;
        }

        state->Count++;
        return 1;
    }
}

internal readonly record struct DipRect(double X, double Y, double Width, double Height);

internal struct DpiEnumerationState
{
    public uint FirstDpiX;
    public uint FirstDpiY;
    public int HasFirst;
    public int Count;
    public int Uniform;
}

[StructLayout(LayoutKind.Sequential)]
internal struct RECT
{
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}

[StructLayout(LayoutKind.Sequential)]
internal struct POINT
{
    public int X;
    public int Y;
}

internal static unsafe partial class User32
{
    [LibraryImport("user32.dll")]
    public static partial nint MonitorFromPoint(POINT pt, uint flags);

    [LibraryImport("user32.dll")]
    public static partial int EnumDisplayMonitors(
        nint hdc,
        RECT* lprcClip,
        delegate* unmanaged[Stdcall]<nint, nint, RECT*, nint, int> lpfnEnum,
        nint dwData);

    // BOOL return is a 4-byte int (nonzero = success); kept as int to stay
    // blittable under the assembly's DisableRuntimeMarshalling.
    [LibraryImport("user32.dll")]
    public static partial int GetWindowRect(nint hwnd, out RECT rect);
}

internal static partial class Shcore
{
    // HRESULT GetDpiForMonitor(HMONITOR, MONITOR_DPI_TYPE, UINT*, UINT*).
    // Shcore.dll is Win8.1+; the app targets Win10+.
    [LibraryImport("shcore.dll")]
    public static partial int GetDpiForMonitor(
        nint hmonitor,
        int dpiType,
        out uint dpiX,
        out uint dpiY);
}

internal static partial class OleAut32
{
    [LibraryImport("oleaut32.dll")]
    public static partial uint SafeArrayGetDim(nint psa);

    [LibraryImport("oleaut32.dll")]
    public static partial int SafeArrayGetLBound(nint psa, uint nDim, out int plLbound);

    [LibraryImport("oleaut32.dll")]
    public static partial int SafeArrayGetUBound(nint psa, uint nDim, out int plUbound);

    [LibraryImport("oleaut32.dll")]
    public static partial int SafeArrayAccessData(nint psa, out nint ppvData);

    [LibraryImport("oleaut32.dll")]
    public static partial int SafeArrayUnaccessData(nint psa);

    [LibraryImport("oleaut32.dll")]
    public static partial int SafeArrayDestroy(nint psa);

    [LibraryImport("oleaut32.dll")]
    public static unsafe partial int VariantClear(VariantValue* pvarg);
}
