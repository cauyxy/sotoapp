using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;

namespace SotoWinNative;

public static unsafe class HookExports
{
    private const int WhKeyboardLl = 13;
    private const uint WmQuit = 0x0012;
    private const int VkShift = 0x10;
    private const int VkControl = 0x11;
    private const int VkMenu = 0x12;
    private const int VkLwin = 0x5B;
    private const int VkRwin = 0x5C;
    private const uint ModifierMeta = 1 << 0;
    private const uint ModifierCtrl = 1 << 1;
    private const uint ModifierAlt = 1 << 2;
    private const uint ModifierShift = 1 << 3;
    private const int EventQueueCapacity = 4096;
    private static readonly object Sync = new();
    private static readonly object QueueSync = new();
    private static readonly WinHookEventRaw[] EventQueue = new WinHookEventRaw[EventQueueCapacity];
    private static HookState? current;
    private static int queueHead;
    private static int queueTail;
    private static int queueCount;
    private static uint droppedEvents;

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_hook_install",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static nint Install(
        delegate* unmanaged[Cdecl]<uint, uint, uint, nuint, uint, nint, int> callback,
        nint userData)
    {
        _ = callback;
        _ = userData;

        lock (Sync)
        {
            if (current is not null)
            {
                return 0;
            }

            ResetQueue();
            var state = new HookState();
            current = state;
            if (!state.Start())
            {
                current = null;
                ResetQueue();
                return 0;
            }

            return GCHandle.ToIntPtr(GCHandle.Alloc(state));
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_hook_shutdown",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int Shutdown(nint handle)
    {
        if (handle == 0)
        {
            return -1;
        }

        var gcHandle = GCHandle.FromIntPtr(handle);
        if (gcHandle.Target is not HookState state)
        {
            return -2;
        }

        state.Stop();
        lock (Sync)
        {
            if (ReferenceEquals(current, state))
            {
                current = null;
            }
        }
        gcHandle.Free();
        ResetQueue();
        return 0;
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_hook_next_event",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int NextEvent(WinHookEventRaw* outEvent)
    {
        if (outEvent is null)
        {
            return -1;
        }

        if (!TryDequeue(out WinHookEventRaw ev))
        {
            return 0;
        }

        *outEvent = ev;
        return 1;
    }

    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvStdcall) })]
    private static nint LowLevelKeyboardProc(int code, nuint wParam, nint lParam)
    {
        HookState? state = current;
        if (code < 0 || state is null)
        {
            return User32.CallNextHookEx(0, code, wParam, lParam);
        }

        KbdLlHookStruct key = *(KbdLlHookStruct*)lParam;
        if (key.ExtraInfo == unchecked((nuint)SotoInjectedInput.ExtraInfoSentinel))
        {
            return User32.CallNextHookEx(0, code, wParam, lParam);
        }

        Enqueue(new WinHookEventRaw
        {
            VkCode = key.VkCode,
            ScanCode = key.ScanCode,
            HookFlags = key.Flags,
            WParam = wParam,
            Modifiers = CurrentModifiers(),
            DroppedCount = 0,
        });
        return User32.CallNextHookEx(0, code, wParam, lParam);
    }

    private static void Enqueue(WinHookEventRaw ev)
    {
        lock (QueueSync)
        {
            if (queueCount == EventQueueCapacity)
            {
                if (droppedEvents < uint.MaxValue)
                {
                    droppedEvents++;
                }
                return;
            }

            EventQueue[queueTail] = ev;
            queueTail = (queueTail + 1) % EventQueueCapacity;
            queueCount++;
        }
    }

    private static bool TryDequeue(out WinHookEventRaw ev)
    {
        lock (QueueSync)
        {
            if (queueCount == 0)
            {
                ev = default;
                return false;
            }

            ev = EventQueue[queueHead];
            queueHead = (queueHead + 1) % EventQueueCapacity;
            queueCount--;
            if (droppedEvents != 0)
            {
                ev.DroppedCount = droppedEvents;
                droppedEvents = 0;
            }
            return true;
        }
    }

    private static void ResetQueue()
    {
        lock (QueueSync)
        {
            queueHead = 0;
            queueTail = 0;
            queueCount = 0;
            droppedEvents = 0;
        }
    }

    private static uint CurrentModifiers()
    {
        uint modifiers = 0;
        if (IsKeyDown(VkLwin) || IsKeyDown(VkRwin))
        {
            modifiers |= ModifierMeta;
        }
        if (IsKeyDown(VkControl))
        {
            modifiers |= ModifierCtrl;
        }
        if (IsKeyDown(VkMenu))
        {
            modifiers |= ModifierAlt;
        }
        if (IsKeyDown(VkShift))
        {
            modifiers |= ModifierShift;
        }
        return modifiers;
    }

    private static bool IsKeyDown(int virtualKey)
    {
        return (User32.GetKeyState(virtualKey) & unchecked((short)0x8000)) != 0;
    }

    private sealed class HookState
    {
        private readonly ManualResetEventSlim installed = new(false);
        private Thread? thread;
        private nint hook;
        private uint threadId;
        private bool installSucceeded;

        public bool Start()
        {
            thread = new Thread(RunLoop)
            {
                IsBackground = true,
                Name = "SotoWinNativeKeyboardHook",
            };
            thread.Start();
            installed.Wait();
            return installSucceeded;
        }

        public void Stop()
        {
            if (threadId != 0)
            {
                _ = User32.PostThreadMessage(threadId, WmQuit, 0, 0);
            }
            thread?.Join(TimeSpan.FromSeconds(5));
        }

        private void RunLoop()
        {
            threadId = Kernel32.GetCurrentThreadId();
            delegate* unmanaged[Stdcall]<int, nuint, nint, nint> proc = &LowLevelKeyboardProc;
            hook = User32.SetWindowsHookEx(WhKeyboardLl, proc, 0, 0);
            installSucceeded = hook != 0;
            installed.Set();
            if (!installSucceeded)
            {
                return;
            }

            while (User32.GetMessage(out Message msg, 0, 0, 0) > 0)
            {
                _ = User32.TranslateMessage(&msg);
                _ = User32.DispatchMessage(&msg);
            }

            _ = User32.UnhookWindowsHookEx(hook);
            hook = 0;
        }
    }
}

[StructLayout(LayoutKind.Sequential)]
public struct WinHookEventRaw
{
    public uint VkCode;
    public uint ScanCode;
    public uint HookFlags;
    public nuint WParam;
    public uint Modifiers;
    public uint DroppedCount;
}

[StructLayout(LayoutKind.Sequential)]
internal struct KbdLlHookStruct
{
    public uint VkCode;
    public uint ScanCode;
    public uint Flags;
    public uint Time;
    public nuint ExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
internal struct Message
{
    public nint Hwnd;
    public uint MessageId;
    public nuint WParam;
    public nint LParam;
    public uint Time;
    public int PointX;
    public int PointY;
}

internal static unsafe partial class User32
{
    [LibraryImport("user32.dll", EntryPoint = "SetWindowsHookExW")]
    public static partial nint SetWindowsHookEx(
        int idHook,
        delegate* unmanaged[Stdcall]<int, nuint, nint, nint> proc,
        nint module,
        uint threadId);

    [LibraryImport("user32.dll")]
    public static partial int UnhookWindowsHookEx(nint hook);

    [LibraryImport("user32.dll")]
    public static partial nint CallNextHookEx(nint hook, int code, nuint wParam, nint lParam);

    [LibraryImport("user32.dll")]
    public static partial short GetKeyState(int virtualKey);

    [LibraryImport("user32.dll", EntryPoint = "PostThreadMessageW")]
    public static partial int PostThreadMessage(uint threadId, uint msg, nuint wParam, nint lParam);

    [LibraryImport("user32.dll", EntryPoint = "GetMessageW")]
    public static partial int GetMessage(out Message msg, nint hwnd, uint min, uint max);

    [LibraryImport("user32.dll")]
    public static partial int TranslateMessage(Message* msg);

    [LibraryImport("user32.dll", EntryPoint = "DispatchMessageW")]
    public static partial nint DispatchMessage(Message* msg);
}

internal static partial class Kernel32
{
    [LibraryImport("kernel32.dll")]
    public static partial uint GetCurrentThreadId();
}
