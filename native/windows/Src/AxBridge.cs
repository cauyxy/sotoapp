using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;

namespace SotoWinNative;

public static unsafe class AxExports
{
    private const int SliceChars = 512;
    private const int TextPatternFallbackChars = 4096;
    private const int TextAnchorAvailable = 1;
    private const int TextAnchorNoFocusedElement = 0;
    private const int TextAnchorNoSelectedRange = -3;
    private const int TextAnchorBlockedElevated = -6;
    private const int TextAnchorMixedDpiUnverified = -7;
    private const int TextAnchorError = -100;
    private const int TextAnchorSourceFocusedElement = 3;

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_ax_is_trusted",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int IsTrusted(byte prompt)
    {
        _ = prompt;
        return 1;
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_text_anchor_contract_version",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int TextAnchorContractVersion() => 1;

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_ax_capture_focused",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int CaptureFocused(AxContextRaw* outCtx)
    {
        if (outCtx is null)
        {
            return -2;
        }

        try
        {
            if (WindowsIntegrity.ForegroundIntegrityBlocksAccess())
            {
                return 0;
            }

            using var apartment = ComApartment.Initialize();
            var automation = UiaAutomation.Create();
            int hr = automation.GetFocusedElement(out var element);
            if (hr < 0 || element is null)
            {
                return 0;
            }

            string focusedElementId = UiaTextAccess.RuntimeId(element);
            if (UiaTextAccess.TrySelectedTextPattern(element, out string selectedText))
            {
                *outCtx = new AxContextRaw
                {
                    FullText = StringInterop.AllocUtf8(selectedText),
                    SelectionStart = 0,
                    SelectionEnd = checked((uint)selectedText.Length),
                    Before = StringInterop.AllocUtf8(""),
                    After = StringInterop.AllocUtf8(""),
                    AxRole = StringInterop.AllocUtf8("TextPattern"),
                    FocusedElementId = StringInterop.AllocUtf8(focusedElementId),
                };
                return 1;
            }

            if (!UiaTextAccess.TryValuePattern(element, out string fullText))
            {
                if (UiaTextAccess.TryCaretWindowText(
                        element,
                        TextPatternFallbackChars,
                        out fullText))
                {
                    int caret = fullText.Length;
                    (string textBefore, string textAfter) = ContextSlices(fullText, caret, caret);
                    *outCtx = new AxContextRaw
                    {
                        FullText = StringInterop.AllocUtf8(fullText),
                        SelectionStart = checked((uint)caret),
                        SelectionEnd = checked((uint)caret),
                        Before = StringInterop.AllocUtf8(textBefore),
                        After = StringInterop.AllocUtf8(textAfter),
                        AxRole = StringInterop.AllocUtf8("TextPattern"),
                        FocusedElementId = StringInterop.AllocUtf8(focusedElementId),
                    };
                    return 1;
                }
                return 0;
            }

            (string before, string after) = ContextSlices(fullText, 0, 0);
            *outCtx = new AxContextRaw
            {
                FullText = StringInterop.AllocUtf8(fullText),
                SelectionStart = 0,
                SelectionEnd = 0,
                Before = StringInterop.AllocUtf8(before),
                After = StringInterop.AllocUtf8(after),
                AxRole = StringInterop.AllocUtf8("ValuePattern"),
                FocusedElementId = StringInterop.AllocUtf8(focusedElementId),
            };
            return 1;
        }
        catch
        {
            return -100;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_ax_context_free",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static void FreeContext(AxContextRaw* ctx)
    {
        if (ctx is null)
        {
            return;
        }

        StringInterop.Free(ctx->FullText);
        StringInterop.Free(ctx->Before);
        StringInterop.Free(ctx->After);
        StringInterop.Free(ctx->AxRole);
        StringInterop.Free(ctx->FocusedElementId);
        *ctx = default;
    }

    // Mirrors macOS soto_ax_caret_bounds: returns the focused element's
    // selection/caret bounds as an Electron-DIP "x,y,width,height" string, or ""
    // on any failure (untrusted, no focus, no TextPattern, no selection range,
    // bounds unavailable). The TS bridge maps "" -> null and falls back to
    // window/mouse/bottom-center. With a non-empty selection (the Transform
    // path always has one) this is the selection rect; for a collapsed caret it
    // is the degenerate range rect when the provider returns one.
    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_ax_caret_bounds",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static nint CaretBounds()
    {
        try
        {
            if (WindowsIntegrity.ForegroundIntegrityBlocksAccess())
            {
                return StringInterop.AllocUtf8("");
            }

            using var apartment = ComApartment.Initialize();
            var automation = UiaAutomation.Create();
            int hr = automation.GetFocusedElement(out var element);
            if (hr < 0 || element is null)
            {
                return StringInterop.AllocUtf8("");
            }

            if (!UiaTextAccess.TryGetSelectionBoundingRect(
                    element,
                    out double left,
                    out double top,
                    out double width,
                    out double height))
            {
                return StringInterop.AllocUtf8("");
            }

            return StringInterop.AllocUtf8(
                DisplayMetrics.PhysicalRectToDipString(left, top, width, height));
        }
        catch
        {
            return StringInterop.AllocUtf8("");
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_ax_text_anchor",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int TextAnchor(TextAnchorRaw* outAnchor)
    {
        if (outAnchor is null)
        {
            return TextAnchorError;
        }
        *outAnchor = default;

        try
        {
            if (WindowsIntegrity.ForegroundIntegrityBlocksAccess())
            {
                return TextAnchorBlockedElevated;
            }

            using var apartment = ComApartment.Initialize();
            var automation = UiaAutomation.Create();
            int hr = automation.GetFocusedElement(out var element);
            if (hr < 0 || element is null)
            {
                return TextAnchorNoFocusedElement;
            }

            if (!DisplayMetrics.SupportsReliableDipConversion())
            {
                return TextAnchorMixedDpiUnverified;
            }

            if (UiaTextAccess.TryGetTextAnchor(
                    element,
                    out int source,
                    out var anchorRect))
            {
                *outAnchor = new TextAnchorRaw
                {
                    Source = source,
                    X = anchorRect.X,
                    Y = anchorRect.Y,
                    Width = anchorRect.Width,
                    Height = anchorRect.Height,
                };
                return TextAnchorAvailable;
            }

            if (UiaTextAccess.TryGetCurrentBoundingRectangle(element, out var focusedRect))
            {
                *outAnchor = new TextAnchorRaw
                {
                    Source = TextAnchorSourceFocusedElement,
                    X = focusedRect.X,
                    Y = focusedRect.Y,
                    Width = focusedRect.Width,
                    Height = focusedRect.Height,
                };
                return TextAnchorAvailable;
            }

            return TextAnchorNoSelectedRange;
        }
        catch
        {
            return TextAnchorError;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_text_anchor_raw_size",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static uint TextAnchorRawSize() => (uint)sizeof(TextAnchorRaw);

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_text_anchor_raw_source_offset",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static uint TextAnchorRawSourceOffset() =>
        (uint)Marshal.OffsetOf<TextAnchorRaw>(nameof(TextAnchorRaw.Source)).ToInt32();

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_text_anchor_raw_x_offset",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static uint TextAnchorRawXOffset() =>
        (uint)Marshal.OffsetOf<TextAnchorRaw>(nameof(TextAnchorRaw.X)).ToInt32();

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_text_anchor_raw_y_offset",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static uint TextAnchorRawYOffset() =>
        (uint)Marshal.OffsetOf<TextAnchorRaw>(nameof(TextAnchorRaw.Y)).ToInt32();

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_text_anchor_raw_width_offset",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static uint TextAnchorRawWidthOffset() =>
        (uint)Marshal.OffsetOf<TextAnchorRaw>(nameof(TextAnchorRaw.Width)).ToInt32();

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_text_anchor_raw_height_offset",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static uint TextAnchorRawHeightOffset() =>
        (uint)Marshal.OffsetOf<TextAnchorRaw>(nameof(TextAnchorRaw.Height)).ToInt32();

    private static (string Before, string After) ContextSlices(
        string fullText,
        int selectionStart,
        int selectionEnd)
    {
        int beforeStart = Math.Max(0, selectionStart - SliceChars);
        int afterEnd = Math.Min(fullText.Length, selectionEnd + SliceChars);
        string before = fullText[beforeStart..selectionStart];
        string after = fullText[selectionEnd..afterEnd];
        return (before, after);
    }
}

internal static class UiaTextAccess
{
    private const int TextPatternCaptureChars = 4096;
    private const int TextPatternRangeEndpointStart = 0;
    private const int TextPatternRangeEndpointEnd = 1;
    private const int TextUnitCharacter = 0;
    private const int UiaValuePatternId = 10002;
    private const int UiaTextPatternId = 10014;
    private const int UiaBoundingRectanglePropertyId = 30001;
    private const int TextAnchorSourceCaret = 1;
    private const int TextAnchorSourceSelection = 2;
    private const double CaretWidthDip = 1.0;
    private const double CaretWidthToleranceDip = 2.0;
    private const ushort VariantTypeR8 = 5;
    private const ushort VariantTypeArray = 0x2000;

    public static string TryValuePattern(IUIAutomationElement element) =>
        TryValuePattern(element, out string value) ? value : "";

    public static bool TryValuePattern(IUIAutomationElement element, out string value)
    {
        value = "";
        if (!TryGetValuePattern(element, out var pattern))
        {
            return false;
        }

        int hr = pattern.get_CurrentValue(out value);
        return hr >= 0;
    }

    public static bool HasEditableValuePattern(IUIAutomationElement element)
    {
        if (!TryGetValuePattern(element, out var pattern))
        {
            return false;
        }

        int hr = pattern.get_CurrentIsReadOnly(out int readOnly);
        return hr >= 0 && readOnly == 0;
    }

    public static bool HasTextPattern(IUIAutomationElement element)
    {
        int hr = element.GetCurrentPattern(UiaTextPatternId, out nint patternPtr);
        return hr >= 0 && patternPtr != 0;
    }

    public static bool TrySelectedTextPattern(IUIAutomationElement element, out string selectedText)
    {
        selectedText = "";
        if (!TryGetTextPattern(element, out var pattern))
        {
            return false;
        }

        if (!TryGetFirstSelectionRange(pattern, out var range))
        {
            return false;
        }

        int hr = range.GetText(TextPatternCaptureChars, out selectedText);
        return hr >= 0 && selectedText.Length > 0;
    }

    public static unsafe string RuntimeId(IUIAutomationElement element)
    {
        int hr = element.GetRuntimeId(out nint safeArray);
        if (hr < 0 || safeArray == 0)
        {
            return "";
        }

        try
        {
            if (OleAut32.SafeArrayGetDim(safeArray) != 1)
            {
                return "";
            }

            if (OleAut32.SafeArrayGetLBound(safeArray, 1, out int lBound) < 0
                || OleAut32.SafeArrayGetUBound(safeArray, 1, out int uBound) < 0)
            {
                return "";
            }

            int count = uBound - lBound + 1;
            if (count <= 0)
            {
                return "";
            }

            if (OleAut32.SafeArrayAccessData(safeArray, out nint data) < 0 || data == 0)
            {
                return "";
            }

            try
            {
                int* values = (int*)data;
                string[] parts = new string[count];
                for (int i = 0; i < count; i++)
                {
                    parts[i] = values[i].ToString();
                }
                return string.Join(".", parts);
            }
            finally
            {
                _ = OleAut32.SafeArrayUnaccessData(safeArray);
            }
        }
        finally
        {
            _ = OleAut32.SafeArrayDestroy(safeArray);
        }
    }

    /// <summary>
    /// Reads the first bounding rectangle of the focused element's current text
    /// selection (physical pixels, top-left origin). UIA returns a SAFEARRAY of
    /// doubles as repeated [left, top, width, height] quads; we take the first
    /// quad (the caret line / selection start) and always destroy the array.
    /// </summary>
    public static unsafe bool TryGetSelectionBoundingRect(
        IUIAutomationElement element,
        out double left,
        out double top,
        out double width,
        out double height)
    {
        left = top = width = height = 0;
        if (!TryGetTextPattern(element, out var pattern))
        {
            return false;
        }

        if (!TryGetFirstSelectionRange(pattern, out var range))
        {
            return false;
        }

        int hr = range.GetBoundingRectangles(out nint safeArray);
        if (hr < 0 || safeArray == 0)
        {
            return false;
        }

        try
        {
            if (OleAut32.SafeArrayGetDim(safeArray) != 1)
            {
                return false;
            }

            if (OleAut32.SafeArrayGetLBound(safeArray, 1, out int lBound) < 0
                || OleAut32.SafeArrayGetUBound(safeArray, 1, out int uBound) < 0)
            {
                return false;
            }

            // One rectangle is four consecutive doubles; bail if UIA returned
            // an empty/degenerate array (e.g. an off-screen or collapsed range).
            if (uBound - lBound + 1 < 4)
            {
                return false;
            }

            if (OleAut32.SafeArrayAccessData(safeArray, out nint data) < 0 || data == 0)
            {
                return false;
            }

            try
            {
                double* values = (double*)data;
                left = values[0];
                top = values[1];
                width = values[2];
                height = values[3];
            }
            finally
            {
                _ = OleAut32.SafeArrayUnaccessData(safeArray);
            }

            return width > 0 && height > 0;
        }
        finally
        {
            _ = OleAut32.SafeArrayDestroy(safeArray);
        }
    }

    public static bool TryGetTextAnchor(
        IUIAutomationElement element,
        out int source,
        out DipRect rect)
    {
        source = 0;
        rect = default;
        if (!TryGetTextPattern(element, out var pattern))
        {
            return false;
        }

        if (!TryGetFirstSelectionRange(pattern, out var range))
        {
            return false;
        }

        if (!TextRangeIsCollapsed(range))
        {
            if (TryGetRangeBoundingRect(
                    range,
                    allowZeroWidth: false,
                    out double left,
                    out double top,
                    out double width,
                    out double height))
            {
                rect = DisplayMetrics.PhysicalRectToDip(left, top, width, height);
                if (UsableDipRect(rect))
                {
                    source = TextAnchorSourceSelection;
                    return true;
                }
            }
            return false;
        }

        if (TryGetRangeBoundingRect(
                range,
                allowZeroWidth: true,
                out double caretLeft,
                out double caretTop,
                out double caretWidth,
                out double caretHeight))
        {
            var exact = DisplayMetrics.PhysicalRectToDip(caretLeft, caretTop, caretWidth, caretHeight);
            if (TrySynthesizeExactCaretRect(exact, out rect))
            {
                source = TextAnchorSourceCaret;
                return true;
            }
        }

        if (TryGetAdjacentCaretRect(range, previous: true, out rect)
            || TryGetAdjacentCaretRect(range, previous: false, out rect))
        {
            source = TextAnchorSourceCaret;
            return true;
        }

        return false;
    }

    public static unsafe bool TryGetCurrentBoundingRectangle(
        IUIAutomationElement element,
        out DipRect rect)
    {
        rect = default;
        var value = default(VariantValue);
        int hr = element.GetCurrentPropertyValue(UiaBoundingRectanglePropertyId, &value);
        try
        {
            if (hr < 0
                || value.Vt != (VariantTypeArray | VariantTypeR8)
                || value.Pointer == 0)
            {
                return false;
            }

            if (!TryReadFirstRectFromSafeArray(
                    value.Pointer,
                    allowZeroWidth: false,
                    out double left,
                    out double top,
                    out double width,
                    out double height))
            {
                return false;
            }

            rect = DisplayMetrics.PhysicalRectToDip(left, top, width, height);
            return UsableDipRect(rect);
        }
        finally
        {
            _ = OleAut32.VariantClear(&value);
        }
    }

    private static bool TextRangeIsCollapsed(IUIAutomationTextRange range)
    {
        int hr = range.GetText(1, out string text);
        text ??= "";
        return hr >= 0 && text.Length == 0;
    }

    private static unsafe bool TryGetRangeBoundingRect(
        IUIAutomationTextRange range,
        bool allowZeroWidth,
        out double left,
        out double top,
        out double width,
        out double height)
    {
        left = top = width = height = 0;
        int hr = range.GetBoundingRectangles(out nint safeArray);
        if (hr < 0 || safeArray == 0)
        {
            return false;
        }

        try
        {
            return TryReadFirstRectFromSafeArray(
                safeArray,
                allowZeroWidth,
                out left,
                out top,
                out width,
                out height);
        }
        finally
        {
            _ = OleAut32.SafeArrayDestroy(safeArray);
        }
    }

    private static unsafe bool TryReadFirstRectFromSafeArray(
        nint safeArray,
        bool allowZeroWidth,
        out double left,
        out double top,
        out double width,
        out double height)
    {
        left = top = width = height = 0;
        if (safeArray == 0 || OleAut32.SafeArrayGetDim(safeArray) != 1)
        {
            return false;
        }

        if (OleAut32.SafeArrayGetLBound(safeArray, 1, out int lBound) < 0
            || OleAut32.SafeArrayGetUBound(safeArray, 1, out int uBound) < 0)
        {
            return false;
        }

        if (uBound - lBound + 1 < 4)
        {
            return false;
        }

        if (OleAut32.SafeArrayAccessData(safeArray, out nint data) < 0 || data == 0)
        {
            return false;
        }

        try
        {
            double* values = (double*)data;
            left = values[0];
            top = values[1];
            width = values[2];
            height = values[3];
        }
        finally
        {
            _ = OleAut32.SafeArrayUnaccessData(safeArray);
        }

        return height > 0 && (allowZeroWidth ? width >= 0 : width > 0);
    }

    private static bool TryGetAdjacentCaretRect(
        IUIAutomationTextRange caretRange,
        bool previous,
        out DipRect rect)
    {
        rect = default;
        int hr = caretRange.Clone(out var adjacentRange);
        if (hr < 0 || adjacentRange is null)
        {
            return false;
        }

        hr = adjacentRange.MoveEndpointByUnit(
            previous ? TextPatternRangeEndpointStart : TextPatternRangeEndpointEnd,
            TextUnitCharacter,
            previous ? -1 : 1,
            out int moved);
        if (hr < 0 || (previous ? moved >= 0 : moved <= 0))
        {
            return false;
        }

        if (!TryGetRangeBoundingRect(
                adjacentRange,
                allowZeroWidth: false,
                out double left,
                out double top,
                out double width,
                out double height))
        {
            return false;
        }

        var adjacent = DisplayMetrics.PhysicalRectToDip(left, top, width, height);
        return TrySynthesizeAdjacentCaretRect(adjacent, previous, out rect);
    }

    private static bool TrySynthesizeExactCaretRect(DipRect exact, out DipRect rect)
    {
        rect = default;
        if (!FiniteDipRect(exact)
            || exact.Width < 0
            || exact.Width > CaretWidthToleranceDip
            || exact.Height <= 0)
        {
            return false;
        }

        double caretX = exact.X + (exact.Width / 2.0);
        rect = new DipRect(caretX - (CaretWidthDip / 2.0), exact.Y, CaretWidthDip, exact.Height);
        return UsableDipRect(rect);
    }

    private static bool TrySynthesizeAdjacentCaretRect(
        DipRect adjacent,
        bool previous,
        out DipRect rect)
    {
        rect = default;
        if (!UsableDipRect(adjacent))
        {
            return false;
        }

        double caretX = previous ? adjacent.X + adjacent.Width : adjacent.X;
        rect = new DipRect(caretX - (CaretWidthDip / 2.0), adjacent.Y, CaretWidthDip, adjacent.Height);
        return UsableDipRect(rect);
    }

    private static bool UsableDipRect(DipRect rect) =>
        FiniteDipRect(rect) && rect.Width > 0 && rect.Height > 0;

    private static bool FiniteDipRect(DipRect rect) =>
        double.IsFinite(rect.X)
            && double.IsFinite(rect.Y)
            && double.IsFinite(rect.Width)
            && double.IsFinite(rect.Height);

    public static bool TryCaretWindowText(
        IUIAutomationElement element,
        int charCount,
        out string text)
    {
        text = "";
        if (charCount <= 0 || !TryGetTextPattern(element, out var pattern))
        {
            return false;
        }

        if (!TryGetFirstSelectionRange(pattern, out var selectionRange))
        {
            return false;
        }

        int hr = selectionRange.Clone(out var caretRange);
        if (hr < 0 || caretRange is null)
        {
            return false;
        }

        hr = caretRange.MoveEndpointByRange(
            TextPatternRangeEndpointStart,
            caretRange,
            TextPatternRangeEndpointEnd);
        if (hr < 0)
        {
            return false;
        }

        hr = caretRange.MoveEndpointByUnit(
            TextPatternRangeEndpointStart,
            TextUnitCharacter,
            -charCount,
            out _);
        if (hr < 0)
        {
            return false;
        }

        hr = caretRange.GetText(charCount, out text);
        text ??= "";
        return hr >= 0;
    }

    private static bool TryGetFirstSelectionRange(
        IUIAutomationTextPattern pattern,
        out IUIAutomationTextRange range)
    {
        range = null!;
        int hr = pattern.GetSelection(out var ranges);
        if (hr < 0 || ranges is null)
        {
            return false;
        }

        hr = ranges.get_Length(out int length);
        if (hr < 0 || length <= 0)
        {
            return false;
        }

        hr = ranges.GetElement(0, out range);
        return hr >= 0 && range is not null;
    }

    private static bool TryGetValuePattern(
        IUIAutomationElement element,
        out IUIAutomationValuePattern pattern)
    {
        pattern = null!;
        int hr = element.GetCurrentPattern(UiaValuePatternId, out nint patternPtr);
        if (hr < 0 || patternPtr == 0)
        {
            return false;
        }

        ComWrappers wrappers = new StrategyBasedComWrappers();
        object patternObject = wrappers.GetOrCreateObjectForComInstance(
            patternPtr,
            CreateObjectFlags.None);
        pattern = (IUIAutomationValuePattern)patternObject;
        return true;
    }

    private static bool TryGetTextPattern(
        IUIAutomationElement element,
        out IUIAutomationTextPattern pattern)
    {
        pattern = null!;
        int hr = element.GetCurrentPattern(UiaTextPatternId, out nint patternPtr);
        if (hr < 0 || patternPtr == 0)
        {
            return false;
        }

        ComWrappers wrappers = new StrategyBasedComWrappers();
        object patternObject = wrappers.GetOrCreateObjectForComInstance(
            patternPtr,
            CreateObjectFlags.None);
        pattern = (IUIAutomationTextPattern)patternObject;
        return true;
    }
}

[StructLayout(LayoutKind.Sequential)]
public struct AxContextRaw
{
    public nint FullText;
    public uint SelectionStart;
    public uint SelectionEnd;
    public nint Before;
    public nint After;
    public nint AxRole;
    public nint FocusedElementId;
}

[StructLayout(LayoutKind.Sequential)]
public struct TextAnchorRaw
{
    public int Source;
    public double X;
    public double Y;
    public double Width;
    public double Height;
}

[GeneratedComInterface]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid(Iid)]
internal unsafe partial interface IUIAutomationValuePattern
{
    public const string Iid = "a94cd8b1-0844-4cd1-9d2d-bb0d2aa78b93";

    [PreserveSig]
    int SetValue([MarshalAs(UnmanagedType.BStr)] string val);

    [PreserveSig]
    int get_CurrentValue([MarshalAs(UnmanagedType.BStr)] out string retVal);

    [PreserveSig]
    int get_CurrentIsReadOnly(out int retVal);
}

[GeneratedComInterface]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid(Iid)]
internal unsafe partial interface IUIAutomationTextPattern
{
    public const string Iid = "32eba289-3583-42c9-9c59-3b6d9a1e9b6a";

    [PreserveSig]
    int RangeFromPoint(UiaPoint pt, out nint range);

    [PreserveSig]
    int RangeFromChild(nint child, out nint range);

    [PreserveSig]
    int GetSelection(out IUIAutomationTextRangeArray ranges);
}

[GeneratedComInterface]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid(Iid)]
internal unsafe partial interface IUIAutomationTextRangeArray
{
    public const string Iid = "ce4ae76a-e717-4c98-81ea-47371d028eb6";

    [PreserveSig]
    int get_Length(out int length);

    [PreserveSig]
    int GetElement(int index, out IUIAutomationTextRange element);
}

[GeneratedComInterface]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid(Iid)]
internal unsafe partial interface IUIAutomationTextRange
{
    public const string Iid = "a543cc6a-f4ae-494b-8239-c814481187a8";

    [PreserveSig]
    int Clone(out IUIAutomationTextRange clonedRange);

    [PreserveSig]
    int Compare(nint range, out int areSame);

    [PreserveSig]
    int CompareEndpoints(int sourceEndPoint, nint targetRange, int targetEndPoint, out int compValue);

    [PreserveSig]
    int ExpandToEnclosingUnit(int textUnit);

    [PreserveSig]
    int FindAttribute(int attributeId, nint value, int backward, out nint foundRange);

    [PreserveSig]
    int FindText([MarshalAs(UnmanagedType.BStr)] string text, int backward, int ignoreCase, out nint foundRange);

    [PreserveSig]
    int GetAttributeValue(int attributeId, out nint value);

    [PreserveSig]
    int GetBoundingRectangles(out nint boundingRectangles);

    [PreserveSig]
    int GetEnclosingElement(out nint enclosingElement);

    [PreserveSig]
    int GetText(int maxLength, [MarshalAs(UnmanagedType.BStr)] out string text);

    [PreserveSig]
    int Move(int unit, int count, out int moved);

    [PreserveSig]
    int MoveEndpointByUnit(int endpoint, int unit, int count, out int moved);

    [PreserveSig]
    int MoveEndpointByRange(int sourceEndPoint, IUIAutomationTextRange targetRange, int targetEndPoint);
}
