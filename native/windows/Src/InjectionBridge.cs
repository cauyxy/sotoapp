using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;

namespace SotoWinNative;

public static unsafe partial class InjectionExports
{
    private const int SelectionAlwaysAppend = 1;
    private const uint InputKeyboard = 1;
    private const ushort VkShift = 0x10;
    private const ushort VkControl = 0x11;
    private const ushort VkMenu = 0x12;
    private const ushort VkC = 0x43;
    private const ushort VkV = 0x56;
    private const ushort VkLeftShift = 0xA0;
    private const ushort VkRightShift = 0xA1;
    private const ushort VkLeftControl = 0xA2;
    private const ushort VkRightControl = 0xA3;
    private const ushort VkLeftMenu = 0xA4;
    private const ushort VkRightMenu = 0xA5;
    private const ushort VkLeftWin = 0x5B;
    private const ushort VkRightWin = 0x5C;
    private const uint KeyeventfKeyup = 0x0002;
    private const uint KeyeventfUnicode = 0x0004;
    private const int NativeAttemptOk = 0;
    private const int NativeAttemptUnsupportedSelectionBehavior = 1;
    private const int NativeAttemptInvalidArgument = -1;
    private const int NativeAttemptSendInputIncomplete = -2;
    private const int NativeAttemptNoFocusedElement = -6;
    private const int NativeAttemptEventPostFailed = -10;
    private const int NativeAttemptBlockedElevated = -11;
    private const int NativeAttemptNativeException = -100;

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_native_insert_text",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int NativeInsertText(byte* text, nuint len, int selectionBehavior)
    {
        if (selectionBehavior == SelectionAlwaysAppend)
        {
            return NativeAttemptUnsupportedSelectionBehavior;
        }

        if (text is null)
        {
            return NativeAttemptInvalidArgument;
        }

        try
        {
            string value = Encoding.UTF8.GetString(text, checked((int)len));
            if (value.Length == 0)
            {
                return NativeAttemptOk;
            }

            int preflightCode = FocusedTargetSyntheticInputAttemptCode();
            if (preflightCode != NativeAttemptOk) return preflightCode;

            return SendUnicodeText(value);
        }
        catch
        {
            return NativeAttemptNativeException;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_send_paste",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int SendPaste()
    {
        try
        {
            // Focus/protection checks are performed by the async TS injector probe.
            // Keep paste synthesis free of UIA work so Electron main only posts input.
            return SendControlChord(VkV);
        }
        catch
        {
            return NativeAttemptNativeException;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_send_copy",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int SendCopy()
    {
        try
        {
            int preflightCode = FocusedTargetSyntheticInputAttemptCode();
            if (preflightCode != NativeAttemptOk) return preflightCode;

            return SendControlChord(VkC);
        }
        catch
        {
            return NativeAttemptNativeException;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_focus_probe",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int FocusProbe()
    {
        try
        {
            if (WindowsIntegrity.ForegroundIntegrityBlocksAccess())
            {
                return 4;
            }

            using var apartment = ComApartment.Initialize();
            var automation = UiaAutomation.Create();
            int hr = automation.GetFocusedElement(out var element);
            if (hr < 0 || element is null)
            {
                return 0;
            }

            if (UiaTextAccess.HasEditableValuePattern(element))
            {
                return 1;
            }

            return 2;
        }
        catch
        {
            return -100;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_type_text_chunk",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int TypeTextChunk(byte* text, nuint len)
    {
        if (text is null)
        {
            return NativeAttemptInvalidArgument;
        }

        try
        {
            string value = Encoding.UTF8.GetString(text, checked((int)len));
            if (value.Length == 0)
            {
                return NativeAttemptOk;
            }

            int preflightCode = FocusedTargetSyntheticInputAttemptCode();
            if (preflightCode != NativeAttemptOk) return preflightCode;

            return SendUnicodeText(value);
        }
        catch
        {
            return NativeAttemptNativeException;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_capture_focused_value",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static nint CaptureFocusedValue()
    {
        try
        {
            return TryReadFocusedValue(out string value) ? StringInterop.AllocUtf8(value) : 0;
        }
        catch
        {
            return 0;
        }
    }

    private static bool TryReadFocusedValue(out string value)
    {
        value = "";
        if (WindowsIntegrity.ForegroundIntegrityBlocksAccess())
        {
            return false;
        }

        using var apartment = ComApartment.Initialize();
        var automation = UiaAutomation.Create();
        int hr = automation.GetFocusedElement(out var element);
        return hr >= 0
            && element is not null
            && UiaTextAccess.HasEditableValuePattern(element)
            && UiaTextAccess.TryValuePattern(element, out value);
    }

    private static int FocusedTargetSyntheticInputAttemptCode()
    {
        if (WindowsIntegrity.ForegroundIntegrityBlocksAccess())
        {
            return NativeAttemptBlockedElevated;
        }

        using var apartment = ComApartment.Initialize();
        var automation = UiaAutomation.Create();
        int hr = automation.GetFocusedElement(out var element);
        if (hr < 0 || element is null)
        {
            return NativeAttemptNoFocusedElement;
        }

        return NativeAttemptOk;
    }

    private static int SendUnicodeText(string value)
    {
        if (value.Length == 0)
        {
            return NativeAttemptOk;
        }

        ReleaseDownModifiers();
        Input[] inputs = UnicodeInputsFor(value);
        fixed (Input* inputPtr = inputs)
        {
            uint sent = User32.SendInput(
                checked((uint)inputs.Length),
                inputPtr,
                sizeof(Input));
            return sent == inputs.Length ? NativeAttemptOk : NativeAttemptSendInputIncomplete;
        }
    }

    private static void ReleaseDownModifiers()
    {
        ushort[] modifiers =
        [
            VkShift,
            VkControl,
            VkMenu,
            VkLeftShift,
            VkRightShift,
            VkLeftControl,
            VkRightControl,
            VkLeftMenu,
            VkRightMenu,
            VkLeftWin,
            VkRightWin,
        ];
        Input[] releases = new Input[modifiers.Length];
        int count = 0;
        foreach (ushort key in modifiers)
        {
            if ((User32.GetAsyncKeyState(key) & unchecked((short)0x8000)) == 0)
            {
                continue;
            }
            releases[count++] = VirtualKeyInput(key, true);
        }

        if (count == 0)
        {
            return;
        }

        fixed (Input* inputPtr = releases)
        {
            _ = User32.SendInput(checked((uint)count), inputPtr, sizeof(Input));
        }
    }

    private static int SendControlChord(ushort key)
    {
        ReleaseDownModifiers();
        Span<Input> inputs = stackalloc Input[4]
        {
            VirtualKeyInput(VkControl, false),
            VirtualKeyInput(key, false),
            VirtualKeyInput(key, true),
            VirtualKeyInput(VkControl, true),
        };
        fixed (Input* inputPtr = inputs)
        {
            uint sent = User32.SendInput(
                checked((uint)inputs.Length),
                inputPtr,
                sizeof(Input));
            return sent == inputs.Length ? NativeAttemptOk : NativeAttemptEventPostFailed;
        }
    }

    private static Input[] UnicodeInputsFor(string value)
    {
        int unitCount = value.Length;
        Input[] inputs = new Input[unitCount * 2];
        int index = 0;
        for (int i = 0; i < unitCount; i++)
        {
            ushort unit = value[i];
            inputs[index++] = UnicodeInput(unit, false);
            inputs[index++] = UnicodeInput(unit, true);
        }
        return inputs;
    }

    private static Input UnicodeInput(ushort codeUnit, bool keyUp) => new()
    {
        Type = InputKeyboard,
        U = new InputUnion
        {
            Ki = new KeyboardInput
            {
                WScan = codeUnit,
                DwFlags = keyUp ? KeyeventfUnicode | KeyeventfKeyup : KeyeventfUnicode,
                DwExtraInfo = unchecked((nuint)SotoInjectedInput.ExtraInfoSentinel),
            },
        },
    };

    private static Input VirtualKeyInput(ushort key, bool keyUp) => new()
    {
        Type = InputKeyboard,
        U = new InputUnion
        {
            Ki = new KeyboardInput
            {
                WVk = key,
                DwFlags = keyUp ? KeyeventfKeyup : 0,
                DwExtraInfo = unchecked((nuint)SotoInjectedInput.ExtraInfoSentinel),
            },
        },
    };
}

[StructLayout(LayoutKind.Sequential)]
internal struct Input
{
    public uint Type;
    public InputUnion U;
}

// Win32 INPUT's union is sized for its largest arm (MOUSEINPUT). Even though
// Soto only fills KEYBDINPUT, SendInput validates sizeof(INPUT) and rejects the
// 32-byte struct produced when this union shrinks to KEYBDINPUT's 24 bytes.
[StructLayout(LayoutKind.Explicit, Size = 32)]
internal struct InputUnion
{
    [FieldOffset(0)]
    public KeyboardInput Ki;
}

[StructLayout(LayoutKind.Sequential)]
internal struct KeyboardInput
{
    public ushort WVk;
    public ushort WScan;
    public uint DwFlags;
    public uint Time;
    public nuint DwExtraInfo;
}

internal static class SotoInjectedInput
{
    public const ulong ExtraInfoSentinel = 0x534F544F5F494E4AUL; // "SOTO_INJ"
}

internal static unsafe partial class User32
{
    [LibraryImport("user32.dll")]
    public static partial uint SendInput(uint inputCount, Input* inputs, int inputSize);

    [LibraryImport("user32.dll")]
    public static partial short GetAsyncKeyState(int virtualKey);
}

internal enum ForegroundIntegrityStatus
{
    NoForeground,
    SameOrLower,
    Elevated,
    Unknown,
}

internal static unsafe class WindowsIntegrity
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint TokenQuery = 0x0008;
    private const int TokenIntegrityLevel = 25;

    public static bool ForegroundIntegrityBlocksAccess()
    {
        var status = InspectForeground();
        return status is not ForegroundIntegrityStatus.SameOrLower;
    }

    public static ForegroundIntegrityStatus InspectForeground()
    {
        nint hwnd = User32.GetForegroundWindow();
        if (hwnd == 0)
        {
            return ForegroundIntegrityStatus.NoForeground;
        }

        uint pid = 0;
        _ = User32.GetWindowThreadProcessId(hwnd, &pid);
        if (pid == 0)
        {
            return ForegroundIntegrityStatus.NoForeground;
        }

        if (!TryCurrentIntegrityRid(out uint currentRid))
        {
            return ForegroundIntegrityStatus.Unknown;
        }

        nint process = Kernel32.OpenProcess(ProcessQueryLimitedInformation, 0, pid);
        if (process == 0)
        {
            return ForegroundIntegrityStatus.Unknown;
        }

        try
        {
            if (!TryProcessIntegrityRid(process, out uint targetRid))
            {
                return ForegroundIntegrityStatus.Unknown;
            }

            return targetRid > currentRid
                ? ForegroundIntegrityStatus.Elevated
                : ForegroundIntegrityStatus.SameOrLower;
        }
        finally
        {
            _ = Kernel32.CloseHandle(process);
        }
    }

    private static bool TryCurrentIntegrityRid(out uint rid) =>
        TryProcessIntegrityRid(Kernel32.GetCurrentProcess(), out rid);

    private static bool TryProcessIntegrityRid(nint process, out uint rid)
    {
        rid = 0;
        if (Advapi32.OpenProcessToken(process, TokenQuery, out nint token) == 0)
        {
            return false;
        }

        try
        {
            return TryTokenIntegrityRid(token, out rid);
        }
        finally
        {
            _ = Kernel32.CloseHandle(token);
        }
    }

    private static bool TryTokenIntegrityRid(nint token, out uint rid)
    {
        rid = 0;
        uint length = 0;
        _ = Advapi32.GetTokenInformation(token, TokenIntegrityLevel, null, 0, &length);
        if (length == 0)
        {
            return false;
        }

        void* buffer = NativeMemory.Alloc(length);
        try
        {
            if (Advapi32.GetTokenInformation(token, TokenIntegrityLevel, buffer, length, &length) == 0)
            {
                return false;
            }

            nint sid = *(nint*)buffer;
            byte* countPtr = Advapi32.GetSidSubAuthorityCount(sid);
            if (countPtr is null || *countPtr == 0)
            {
                return false;
            }

            uint* ridPtr = Advapi32.GetSidSubAuthority(sid, (uint)(*countPtr - 1));
            if (ridPtr is null)
            {
                return false;
            }

            rid = *ridPtr;
            return true;
        }
        finally
        {
            NativeMemory.Free(buffer);
        }
    }
}

internal static unsafe partial class Kernel32
{
    [LibraryImport("kernel32.dll")]
    public static partial nint GetCurrentProcess();

    [LibraryImport("kernel32.dll")]
    public static partial nint OpenProcess(uint desiredAccess, int inheritHandle, uint processId);

    [LibraryImport("kernel32.dll")]
    public static partial int CloseHandle(nint handle);
}

internal static unsafe partial class Advapi32
{
    [LibraryImport("advapi32.dll")]
    public static partial int OpenProcessToken(nint processHandle, uint desiredAccess, out nint tokenHandle);

    [LibraryImport("advapi32.dll")]
    public static partial int GetTokenInformation(
        nint tokenHandle,
        int tokenInformationClass,
        void* tokenInformation,
        uint tokenInformationLength,
        uint* returnLength);

    [LibraryImport("advapi32.dll")]
    public static partial byte* GetSidSubAuthorityCount(nint sid);

    [LibraryImport("advapi32.dll")]
    public static partial uint* GetSidSubAuthority(nint sid, uint subAuthority);
}
