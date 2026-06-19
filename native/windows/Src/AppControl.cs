using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;

namespace SotoWinNative;

public static unsafe partial class AppControlExports
{
    private const int MaxWindowTitleChars = 512;
    private const int SwRestore = 9;

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_frontmost_pid",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int FrontmostPid()
    {
        try
        {
            return ForegroundPid();
        }
        catch
        {
            return -100;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_frontmost_localized_name",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static nint FrontmostLocalizedName()
    {
        try
        {
            int pid = ForegroundPid();
            if (pid > 0)
            {
                try
                {
                    using Process process = Process.GetProcessById(pid);
                    if (!string.IsNullOrWhiteSpace(process.ProcessName))
                    {
                        return StringInterop.AllocUtf8(process.ProcessName);
                    }
                }
                catch
                {
                    // Fall back to the foreground window title below.
                }
            }

            return StringInterop.AllocUtf8(ForegroundWindowTitle());
        }
        catch
        {
            return StringInterop.AllocUtf8("Unknown");
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_frontmost_window_title",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static nint FrontmostWindowTitle()
    {
        try
        {
            return StringInterop.AllocUtf8(ForegroundWindowTitle());
        }
        catch
        {
            return StringInterop.AllocUtf8("");
        }
    }

    // Mirrors macOS soto_frontmost_window_bounds: the foreground window's rect
    // as an Electron-DIP "x,y,width,height" string, or "" on failure. macOS
    // reads CGWindowList (already top-left DIP); here GetWindowRect reports
    // physical pixels, so convert via DisplayMetrics.
    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_frontmost_window_bounds",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static nint FrontmostWindowBounds()
    {
        try
        {
            nint hwnd = User32.GetForegroundWindow();
            if (hwnd == 0)
            {
                return StringInterop.AllocUtf8("");
            }

            if (User32.GetWindowRect(hwnd, out RECT rect) == 0)
            {
                return StringInterop.AllocUtf8("");
            }

            double width = rect.Right - rect.Left;
            double height = rect.Bottom - rect.Top;
            if (width <= 1 || height <= 1)
            {
                return StringInterop.AllocUtf8("");
            }

            return StringInterop.AllocUtf8(
                DisplayMetrics.PhysicalRectToDipString(rect.Left, rect.Top, width, height));
        }
        catch
        {
            return StringInterop.AllocUtf8("");
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_activate_app",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int ActivateApp(int pid)
    {
        if (pid <= 0)
        {
            return -1;
        }

        try
        {
            EnumWindowContext context = new()
            {
                TargetPid = (uint)pid,
                Hwnd = 0,
            };
            delegate* unmanaged[Stdcall]<nint, nint, int> callback = &EnumWindowsCallback;
            _ = User32.EnumWindows(callback, (nint)(&context));
            if (context.Hwnd == 0)
            {
                return -2;
            }

            _ = User32.ShowWindow(context.Hwnd, SwRestore);
            return User32.SetForegroundWindow(context.Hwnd) == 0 ? -3 : 0;
        }
        catch
        {
            return -100;
        }
    }

    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvStdcall) })]
    private static int EnumWindowsCallback(nint hwnd, nint lParam)
    {
        EnumWindowContext* context = (EnumWindowContext*)lParam;
        if (User32.IsWindowVisible(hwnd) == 0)
        {
            return 1;
        }

        uint pid = 0;
        _ = User32.GetWindowThreadProcessId(hwnd, &pid);
        if (pid == context->TargetPid)
        {
            context->Hwnd = hwnd;
            return 0;
        }

        return 1;
    }

    private static int ForegroundPid()
    {
        nint hwnd = User32.GetForegroundWindow();
        if (hwnd == 0)
        {
            return -1;
        }

        uint pid = 0;
        _ = User32.GetWindowThreadProcessId(hwnd, &pid);
        return pid == 0 ? -1 : checked((int)pid);
    }

    private static string ForegroundWindowTitle()
    {
        nint hwnd = User32.GetForegroundWindow();
        if (hwnd == 0)
        {
            return "Unknown";
        }

        Span<char> title = stackalloc char[MaxWindowTitleChars];
        fixed (char* titlePtr = title)
        {
            int len = User32.GetWindowText(hwnd, titlePtr, title.Length);
            return len <= 0 ? "Unknown" : new string(title[..len]);
        }
    }

    private struct EnumWindowContext
    {
        public uint TargetPid;
        public nint Hwnd;
    }
}

internal static unsafe class StringInterop
{
    public static nint AllocUtf8(string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        byte* ptr = (byte*)NativeMemory.Alloc((nuint)bytes.Length + 1);
        for (int i = 0; i < bytes.Length; i++)
        {
            ptr[i] = bytes[i];
        }
        ptr[bytes.Length] = 0;
        return (nint)ptr;
    }

    public static void Free(nint ptr)
    {
        if (ptr != 0)
        {
            NativeMemory.Free((void*)ptr);
        }
    }
}

public static unsafe class CommonExports
{
    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_free_string",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static void FreeString(nint ptr)
    {
        StringInterop.Free(ptr);
    }
}

internal static unsafe partial class User32
{
    [LibraryImport("user32.dll")]
    public static partial nint GetForegroundWindow();

    [LibraryImport("user32.dll")]
    public static partial uint GetWindowThreadProcessId(nint hwnd, uint* processId);

    [LibraryImport("user32.dll", EntryPoint = "GetWindowTextW")]
    public static partial int GetWindowText(nint hwnd, char* text, int maxCount);

    [LibraryImport("user32.dll")]
    public static partial int EnumWindows(
        delegate* unmanaged[Stdcall]<nint, nint, int> callback,
        nint lParam);

    [LibraryImport("user32.dll")]
    public static partial int IsWindowVisible(nint hwnd);

    [LibraryImport("user32.dll")]
    public static partial int ShowWindow(nint hwnd, int command);

    [LibraryImport("user32.dll")]
    public static partial int SetForegroundWindow(nint hwnd);
}
