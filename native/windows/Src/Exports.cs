using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;

[assembly: DisableRuntimeMarshalling]

namespace SotoWinNative;

public static class Exports
{
    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_uia_smoke",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int UiaSmoke()
    {
        try
        {
            using var apartment = ComApartment.Initialize();
            var automation = UiaAutomation.Create();
            int hr = automation.GetFocusedElement(out var element);
            return hr < 0 ? -1 : element is null ? 1 : 0;
        }
        catch
        {
            return -100;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_uia_error_path",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int UiaErrorPath()
    {
        try
        {
            using var apartment = ComApartment.Initialize();
            return UiaAutomation.CreateWithInvalidInterfaceForTest();
        }
        catch (COMException error)
        {
            return error.HResult;
        }
        catch
        {
            return -100;
        }
    }
}

internal static class UiaAutomation
{
    private const uint ClsctxInprocServer = 0x1;
    private static readonly Guid CuiAutomationClsid = new("ff48dba4-60ef-4201-aa87-54103eef594e");
    private static readonly Guid IuiAutomationIid = new(IUIAutomation.Iid);
    private static readonly Guid InvalidIid = Guid.Empty;

    public static unsafe IUIAutomation Create()
    {
        Guid clsid = CuiAutomationClsid;
        Guid iid = IuiAutomationIid;
        nint automationPtr;
        int hr = Ole32.CoCreateInstance(
            &clsid,
            0,
            ClsctxInprocServer,
            &iid,
            &automationPtr);
        Marshal.ThrowExceptionForHR(hr);
        ComWrappers wrappers = new StrategyBasedComWrappers();
        object automation = wrappers.GetOrCreateObjectForComInstance(
            automationPtr,
            CreateObjectFlags.None);
        return (IUIAutomation)automation;
    }

    public static unsafe int CreateWithInvalidInterfaceForTest()
    {
        Guid clsid = CuiAutomationClsid;
        Guid iid = InvalidIid;
        nint automationPtr;
        int hr = Ole32.CoCreateInstance(
            &clsid,
            0,
            ClsctxInprocServer,
            &iid,
            &automationPtr);
        Marshal.ThrowExceptionForHR(hr);
        return hr < 0 ? hr : -100;
    }
}

internal sealed class ComApartment : IDisposable
{
    private const uint CoinitMultithreaded = 0x0;
    private const int SOk = 0;
    private const int SFalse = 1;
    // The thread is already initialized in a DIFFERENT apartment model. This is
    // the steady state on Electron's main thread, which Chromium initializes as
    // STA: a sync native call (e.g. audio_set_output_muted) runs there, and a
    // COINIT_MULTITHREADED request returns this. COM is still fully usable on the
    // thread — we simply must NOT CoUninitialize (we never added a ref). The
    // async native calls land on libuv worker threads where CoInitializeEx
    // returns S_OK instead, which is why only the sync audio path was failing.
    private const int RpcEChangedMode = unchecked((int)0x80010106);
    private readonly bool ownsInitialization;

    private ComApartment(bool ownsInitialization)
    {
        this.ownsInitialization = ownsInitialization;
    }

    public static ComApartment Initialize()
    {
        int hr = Ole32.CoInitializeEx(0, CoinitMultithreaded);
        if (hr != SOk && hr != SFalse && hr != RpcEChangedMode)
        {
            Marshal.ThrowExceptionForHR(hr);
        }

        // Balance CoUninitialize only when WE initialized the apartment (S_OK /
        // S_FALSE). On RPC_E_CHANGED_MODE the thread owned its apartment already.
        return new ComApartment(hr == SOk || hr == SFalse);
    }

    public void Dispose()
    {
        if (ownsInitialization)
        {
            Ole32.CoUninitialize();
        }
    }
}

[GeneratedComInterface]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid(Iid)]
internal partial interface IUIAutomation
{
    public const string Iid = "30cbe57d-d9d0-452a-ab13-7ac5ac4825ee";

    [PreserveSig]
    int CompareElements(nint el1, nint el2, out int areSame);

    [PreserveSig]
    int CompareRuntimeIds(nint runtimeId1, nint runtimeId2, out int areSame);

    [PreserveSig]
    int GetRootElement(out IUIAutomationElement root);

    [PreserveSig]
    int ElementFromHandle(nint hwnd, out IUIAutomationElement element);

    [PreserveSig]
    int ElementFromPoint(UiaPoint pt, out IUIAutomationElement element);

    [PreserveSig]
    int GetFocusedElement(out IUIAutomationElement element);
}

[GeneratedComInterface]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid(Iid)]
internal unsafe partial interface IUIAutomationElement
{
    public const string Iid = "d22108aa-8ac5-49a5-837b-37bbb3d7591e";

    [PreserveSig]
    int SetFocus();

    [PreserveSig]
    int GetRuntimeId(out nint runtimeId);

    [PreserveSig]
    int FindFirst(int scope, nint condition, out nint found);

    [PreserveSig]
    int FindAll(int scope, nint condition, out nint found);

    [PreserveSig]
    int FindFirstBuildCache(int scope, nint condition, nint cacheRequest, out nint found);

    [PreserveSig]
    int FindAllBuildCache(int scope, nint condition, nint cacheRequest, out nint found);

    [PreserveSig]
    int BuildUpdatedCache(nint cacheRequest, out nint updatedElement);

    [PreserveSig]
    int GetCurrentPropertyValue(int propertyId, VariantValue* retVal);

    [PreserveSig]
    int GetCurrentPropertyValueEx(int propertyId, int ignoreDefaultValue, VariantValue* retVal);

    [PreserveSig]
    int GetCachedPropertyValue(int propertyId, out nint retVal);

    [PreserveSig]
    int GetCachedPropertyValueEx(int propertyId, int ignoreDefaultValue, out nint retVal);

    [PreserveSig]
    int GetCurrentPatternAs(int patternId, Guid* riid, out nint patternObject);

    [PreserveSig]
    int GetCachedPatternAs(int patternId, Guid* riid, out nint patternObject);

    [PreserveSig]
    int GetCurrentPattern(int patternId, out nint patternObject);
}

[StructLayout(LayoutKind.Sequential)]
internal struct UiaPoint
{
    public double X;
    public double Y;
}

[StructLayout(LayoutKind.Explicit, Size = 16)]
internal struct VariantValue
{
    [FieldOffset(0)]
    public ushort Vt;

    [FieldOffset(8)]
    public short Bool;

    [FieldOffset(8)]
    public nint Pointer;
}

internal static unsafe partial class Ole32
{
    [LibraryImport("Ole32")]
    public static partial int CoInitializeEx(nint reserved, uint coInit);

    [LibraryImport("Ole32")]
    public static partial void CoUninitialize();

    [LibraryImport("Ole32")]
    public static partial int CoCreateInstance(
        Guid* rclsid,
        nint pUnkOuter,
        uint dwClsContext,
        Guid* riid,
        nint* ppv);
}
