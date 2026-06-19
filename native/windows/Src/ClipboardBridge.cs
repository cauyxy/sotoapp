using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;

namespace SotoWinNative;

public static unsafe partial class ClipboardExports
{
    private const uint CfText = 1;
    private const uint CfBitmap = 2;
    private const uint CfMetafilePict = 3;
    private const uint CfOemText = 7;
    private const uint CfPalette = 9;
    private const uint CfUnicodeText = 13;
    private const uint CfEnhMetafile = 14;
    private const uint CfLocale = 16;
    private const uint CfOwnerDisplay = 0x80;
    private const uint CfDspText = 0x81;
    private const uint CfDspEnhMetafile = 0x8E;
    private const uint CfPrivateFirst = 0x200;
    private const uint CfPrivateLast = 0x2FF;
    private const uint CfGdiObjFirst = 0x300;
    private const uint CfGdiObjLast = 0x3FF;
    private const uint GmemMoveable = 0x0002;
    private const long MaxSnapshotBytes = 50L * 1024 * 1024;
    private const string ExcludeClipboardFormat = "ExcludeClipboardContentFromMonitorProcessing";
    private const string IncludeHistoryFormat = "CanIncludeInClipboardHistory";
    private const string UploadCloudFormat = "CanUploadToCloudClipboard";
    private static readonly object SnapshotSync = new();
    private static readonly uint ExcludeFormat = User32.RegisterClipboardFormat(ExcludeClipboardFormat);
    private static readonly uint IncludeHistoryFormatId = User32.RegisterClipboardFormat(IncludeHistoryFormat);
    private static readonly uint UploadCloudFormatId = User32.RegisterClipboardFormat(UploadCloudFormat);
    private static CapturedClipboardFormat[]? capturedFormats;

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_clipboard_read_text",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static nint ReadText()
    {
        if (User32.OpenClipboard(0) == 0)
        {
            return 0;
        }

        try
        {
            if (User32.IsClipboardFormatAvailable(CfUnicodeText) == 0)
            {
                return StringInterop.AllocUtf8("");
            }

            nint handle = User32.GetClipboardData(CfUnicodeText);
            if (handle == 0)
            {
                return 0;
            }

            char* locked = (char*)Kernel32.GlobalLock(handle);
            if (locked is null)
            {
                return 0;
            }

            try
            {
                return StringInterop.AllocUtf8(new string(locked));
            }
            finally
            {
                _ = Kernel32.GlobalUnlock(handle);
            }
        }
        finally
        {
            _ = User32.CloseClipboard();
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_clipboard_write_text",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int WriteText(byte* text, nuint len)
    {
        if (text is null)
        {
            return -1;
        }

        try
        {
            string value = Encoding.UTF8.GetString(text, checked((int)len));
            return WriteClipboardText(value, excludedFromHistory: false);
        }
        catch
        {
            return -100;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_clipboard_snapshot_kind",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int SnapshotKind()
    {
        if (User32.OpenClipboard(0) == 0)
        {
            return -100;
        }

        try
        {
            uint format = 0;
            while ((format = User32.EnumClipboardFormats(format)) != 0)
            {
                if (IsMarkerFormat(format))
                {
                    continue;
                }

                return 1;
            }
            return 0;
        }
        finally
        {
            _ = User32.CloseClipboard();
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_clipboard_capture",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int Capture()
    {
        lock (SnapshotSync)
        {
            capturedFormats = null;
        }

        if (User32.OpenClipboard(0) == 0)
        {
            return -1;
        }

        try
        {
            bool sawNonMarker = false;
            long totalCapturedBytes = 0;
            var formats = new List<CapturedClipboardFormat>();

            uint format = 0;
            while ((format = User32.EnumClipboardFormats(format)) != 0)
            {
                if (IsMarkerFormat(format))
                {
                    continue;
                }

                sawNonMarker = true;
                if (IsSynthesizedOrHandleFormat(format))
                {
                    continue;
                }

                if (!TryCaptureFormat(format, MaxSnapshotBytes - totalCapturedBytes, out byte[] bytes, out bool budgetExceeded))
                {
                    if (budgetExceeded)
                    {
                        return -3;
                    }

                    // Unreadable, non-HGLOBAL, or promised data is skipped rather than byte-copied.
                    continue;
                }

                totalCapturedBytes += bytes.LongLength;
                formats.Add(new CapturedClipboardFormat(format, bytes));
            }

            if (sawNonMarker && formats.Count == 0)
            {
                return -2;
            }

            lock (SnapshotSync)
            {
                capturedFormats = formats.ToArray();
            }
            return formats.Count;
        }
        catch
        {
            return -100;
        }
        finally
        {
            _ = User32.CloseClipboard();
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_clipboard_restore",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int Restore()
    {
        CapturedClipboardFormat[] snapshot;
        lock (SnapshotSync)
        {
            if (capturedFormats is null)
            {
                return -1;
            }
            snapshot = capturedFormats;
        }

        if (User32.OpenClipboard(0) == 0)
        {
            return -2;
        }

        try
        {
            if (User32.EmptyClipboard() == 0)
            {
                return -3;
            }

            foreach (CapturedClipboardFormat format in snapshot)
            {
                nint handle = AllocDataHandle(format.Bytes);
                if (handle == 0)
                {
                    return -4;
                }

                if (User32.SetClipboardData(format.FormatId, handle) == 0)
                {
                    Kernel32.GlobalFree(handle);
                    return -5;
                }
            }

            return 0;
        }
        catch
        {
            return -100;
        }
        finally
        {
            _ = User32.CloseClipboard();
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_clipboard_set_excluded",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int WriteExcluded(byte* text, nuint len)
    {
        if (text is null)
        {
            return -1;
        }

        try
        {
            string value = Encoding.UTF8.GetString(text, checked((int)len));
            return WriteClipboardText(value, excludedFromHistory: true);
        }
        catch
        {
            return -100;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_clipboard_change_count",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static uint ChangeCount() => User32.GetClipboardSequenceNumber();

    private static int WriteClipboardText(string value, bool excludedFromHistory)
    {
        if (User32.OpenClipboard(0) == 0)
        {
            return -2;
        }

        try
        {
            if (User32.EmptyClipboard() == 0)
            {
                return -3;
            }

            nint handle = AllocUnicodeTextHandle(value);
            if (handle == 0)
            {
                return -4;
            }

            if (User32.SetClipboardData(CfUnicodeText, handle) == 0)
            {
                Kernel32.GlobalFree(handle);
                return -5;
            }

            if (excludedFromHistory && !WriteExclusionMarkers())
            {
                return -6;
            }

            return 0;
        }
        finally
        {
            _ = User32.CloseClipboard();
        }
    }

    private static bool WriteExclusionMarkers() =>
        SetClipboardDword(ExcludeClipboardFormat, 0)
        && SetClipboardDword(IncludeHistoryFormat, 0)
        && SetClipboardDword(UploadCloudFormat, 0);

    private static bool SetClipboardDword(string formatName, uint value)
    {
        uint format = User32.RegisterClipboardFormat(formatName);
        if (format == 0)
        {
            return false;
        }

        nint handle = AllocDwordHandle(value);
        if (handle == 0)
        {
            return false;
        }

        if (User32.SetClipboardData(format, handle) == 0)
        {
            Kernel32.GlobalFree(handle);
            return false;
        }
        return true;
    }

    private static bool IsSynthesizedOrHandleFormat(uint format) =>
        format == CfText
        || format == CfOemText
        || format == CfLocale
        || format == CfBitmap
        || format == CfMetafilePict
        || format == CfPalette
        || format == CfEnhMetafile
        || format == CfOwnerDisplay
        || (format >= CfDspText && format <= CfDspEnhMetafile)
        || (format >= CfPrivateFirst && format <= CfPrivateLast)
        || (format >= CfGdiObjFirst && format <= CfGdiObjLast);

    private static bool IsMarkerFormat(uint format) =>
        (ExcludeFormat != 0 && format == ExcludeFormat)
        || (IncludeHistoryFormatId != 0 && format == IncludeHistoryFormatId)
        || (UploadCloudFormatId != 0 && format == UploadCloudFormatId);

    private static bool TryCaptureFormat(
        uint format,
        long remainingBytes,
        out byte[] bytes,
        out bool budgetExceeded)
    {
        bytes = [];
        budgetExceeded = false;
        nint handle = User32.GetClipboardData(format);
        if (handle == 0)
        {
            return false;
        }

        nuint size = Kernel32.GlobalSize(handle);
        if (size == 0)
        {
            return false;
        }

        if (size > (nuint)remainingBytes)
        {
            budgetExceeded = true;
            return false;
        }

        if (size > int.MaxValue)
        {
            return false;
        }

        byte* locked = (byte*)Kernel32.GlobalLock(handle);
        if (locked is null)
        {
            return false;
        }

        try
        {
            bytes = new ReadOnlySpan<byte>(locked, checked((int)size)).ToArray();
            return true;
        }
        finally
        {
            _ = Kernel32.GlobalUnlock(handle);
        }
    }

    private static nint AllocUnicodeTextHandle(string value)
    {
        nuint byteCount = checked((nuint)((value.Length + 1) * sizeof(char)));
        nint handle = Kernel32.GlobalAlloc(GmemMoveable, byteCount);
        if (handle == 0)
        {
            return 0;
        }

        char* locked = (char*)Kernel32.GlobalLock(handle);
        if (locked is null)
        {
            Kernel32.GlobalFree(handle);
            return 0;
        }

        try
        {
            value.AsSpan().CopyTo(new Span<char>(locked, value.Length));
            locked[value.Length] = '\0';
            return handle;
        }
        finally
        {
            _ = Kernel32.GlobalUnlock(handle);
        }
    }

    private static nint AllocDwordHandle(uint value)
    {
        nint handle = Kernel32.GlobalAlloc(GmemMoveable, sizeof(uint));
        if (handle == 0)
        {
            return 0;
        }

        uint* locked = (uint*)Kernel32.GlobalLock(handle);
        if (locked is null)
        {
            Kernel32.GlobalFree(handle);
            return 0;
        }

        try
        {
            *locked = value;
            return handle;
        }
        finally
        {
            _ = Kernel32.GlobalUnlock(handle);
        }
    }

    private static nint AllocDataHandle(byte[] bytes)
    {
        nint handle = Kernel32.GlobalAlloc(GmemMoveable, checked((nuint)bytes.Length));
        if (handle == 0)
        {
            return 0;
        }

        byte* locked = (byte*)Kernel32.GlobalLock(handle);
        if (locked is null)
        {
            Kernel32.GlobalFree(handle);
            return 0;
        }

        try
        {
            bytes.CopyTo(new Span<byte>(locked, bytes.Length));
            return handle;
        }
        finally
        {
            _ = Kernel32.GlobalUnlock(handle);
        }
    }

    private readonly record struct CapturedClipboardFormat(uint FormatId, byte[] Bytes);
}

internal static unsafe partial class User32
{
    [LibraryImport("user32.dll")]
    public static partial int OpenClipboard(nint newOwner);

    [LibraryImport("user32.dll")]
    public static partial int CloseClipboard();

    [LibraryImport("user32.dll")]
    public static partial int EmptyClipboard();

    [LibraryImport("user32.dll")]
    public static partial int IsClipboardFormatAvailable(uint format);

    [LibraryImport("user32.dll")]
    public static partial uint EnumClipboardFormats(uint format);

    [LibraryImport("user32.dll", EntryPoint = "RegisterClipboardFormatW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial uint RegisterClipboardFormat(string format);

    [LibraryImport("user32.dll")]
    public static partial uint GetClipboardSequenceNumber();

    [LibraryImport("user32.dll")]
    public static partial nint GetClipboardData(uint format);

    [LibraryImport("user32.dll")]
    public static partial nint SetClipboardData(uint format, nint mem);
}

internal static partial class Kernel32
{
    [LibraryImport("kernel32.dll")]
    public static partial nint GlobalAlloc(uint flags, nuint bytes);

    [LibraryImport("kernel32.dll")]
    public static partial nint GlobalLock(nint mem);

    [LibraryImport("kernel32.dll")]
    public static partial nuint GlobalSize(nint mem);

    [LibraryImport("kernel32.dll")]
    public static partial int GlobalUnlock(nint mem);

    [LibraryImport("kernel32.dll")]
    public static partial nint GlobalFree(nint mem);
}
