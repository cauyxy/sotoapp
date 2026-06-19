using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;

namespace SotoWinNative;

// Media-mute via WASAPI: toggle the DEFAULT RENDER ENDPOINT's mute flag
// (IAudioEndpointVolume::SetMute). This silences output without changing the
// volume LEVEL and without pausing playback — unmuting restores the exact prior
// level, and the user-facing master volume is never modified.
//
// This mirrors the macOS CoreAudio device-mute approach for symmetry. A more
// granular alternative is per-process muting via IAudioSessionManager2 +
// ISimpleAudioVolume over every session EXCEPT our own PID; the endpoint mute is
// chosen here as the simplest, robust, non-destructive lever. The @soto/core
// MediaMuteCoordinator owns the save/restore so the prior flag is always honored.
//
// Return codes match the koffi ABI: is_output_muted → 1 muted / 0 unmuted / -1
// error; set_output_muted → 0 ok / -1 error.
//
// NOTE: this file is authored to the same NativeAOT + source-generated COM
// pattern as Exports.cs/AppControl.cs but is not build-verified on the macOS dev
// machine (the win-x64 NativeAOT DLL is produced/loaded only on Windows).
public static unsafe class AudioControlExports
{
    private const uint ClsctxAll = 0x17;
    private static readonly Guid MmDeviceEnumeratorClsid =
        new("BCDE0395-E52F-467C-8E3D-C4579291692E");
    private static readonly Guid IMmDeviceEnumeratorIid =
        new("A95664D2-9614-4F35-A746-DE8DB63617E6");
    private static readonly Guid IAudioEndpointVolumeIid =
        new("5CDF2C82-841E-4546-9722-0CF74078229A");

    private const int ERender = 0;
    private const int EConsole = 0;

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_audio_is_output_muted",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int IsOutputMuted()
    {
        try
        {
            using var apartment = ComApartment.Initialize();
            IAudioEndpointVolume? volume = EndpointVolume();
            if (volume is null)
            {
                return -1;
            }

            int hr = volume.GetMute(out int muted);
            return hr < 0 ? -1 : (muted != 0 ? 1 : 0);
        }
        catch
        {
            return -1;
        }
    }

    [UnmanagedCallersOnly(
        EntryPoint = "soto_win_audio_set_output_muted",
        CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int SetOutputMuted(int muted)
    {
        try
        {
            using var apartment = ComApartment.Initialize();
            IAudioEndpointVolume? volume = EndpointVolume();
            if (volume is null)
            {
                return -1;
            }

            int hr = volume.SetMute(muted != 0 ? 1 : 0, null);
            return hr < 0 ? -1 : 0;
        }
        catch
        {
            return -1;
        }
    }

    private static IAudioEndpointVolume? EndpointVolume()
    {
        Guid clsid = MmDeviceEnumeratorClsid;
        Guid iid = IMmDeviceEnumeratorIid;
        nint enumeratorPtr;
        int hr = Ole32.CoCreateInstance(&clsid, 0, ClsctxAll, &iid, &enumeratorPtr);
        if (hr < 0 || enumeratorPtr == 0)
        {
            return null;
        }

        ComWrappers wrappers = new StrategyBasedComWrappers();
        var enumerator = (IMMDeviceEnumerator)wrappers.GetOrCreateObjectForComInstance(
            enumeratorPtr,
            CreateObjectFlags.None);

        hr = enumerator.GetDefaultAudioEndpoint(ERender, EConsole, out nint devicePtr);
        if (hr < 0 || devicePtr == 0)
        {
            return null;
        }

        var device = (IMMDevice)wrappers.GetOrCreateObjectForComInstance(
            devicePtr,
            CreateObjectFlags.None);

        Guid epvIid = IAudioEndpointVolumeIid;
        hr = device.Activate(&epvIid, ClsctxAll, 0, out nint volumePtr);
        if (hr < 0 || volumePtr == 0)
        {
            return null;
        }

        return (IAudioEndpointVolume)wrappers.GetOrCreateObjectForComInstance(
            volumePtr,
            CreateObjectFlags.None);
    }
}

[GeneratedComInterface]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
internal unsafe partial interface IMMDeviceEnumerator
{
    [PreserveSig]
    int EnumAudioEndpoints(int dataFlow, uint dwStateMask, out nint ppDevices);

    [PreserveSig]
    int GetDefaultAudioEndpoint(int dataFlow, int role, out nint ppEndpoint);
}

[GeneratedComInterface]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
internal unsafe partial interface IMMDevice
{
    [PreserveSig]
    int Activate(Guid* iid, uint dwClsCtx, nint pActivationParams, out nint ppInterface);
}

// IAudioEndpointVolume — all methods declared (in vtable order) so SetMute (slot
// 12) and GetMute (slot 13) land at the correct offsets. Only those two are
// called; the rest are placeholders that preserve the layout.
[GeneratedComInterface]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
internal unsafe partial interface IAudioEndpointVolume
{
    [PreserveSig]
    int RegisterControlChangeNotify(nint pNotify);

    [PreserveSig]
    int UnregisterControlChangeNotify(nint pNotify);

    [PreserveSig]
    int GetChannelCount(out uint pnChannelCount);

    [PreserveSig]
    int SetMasterVolumeLevel(float fLevelDB, Guid* pguidEventContext);

    [PreserveSig]
    int SetMasterVolumeLevelScalar(float fLevel, Guid* pguidEventContext);

    [PreserveSig]
    int GetMasterVolumeLevel(out float pfLevelDB);

    [PreserveSig]
    int GetMasterVolumeLevelScalar(out float pfLevel);

    [PreserveSig]
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid* pguidEventContext);

    [PreserveSig]
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid* pguidEventContext);

    [PreserveSig]
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);

    [PreserveSig]
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);

    [PreserveSig]
    int SetMute(int bMute, Guid* pguidEventContext);

    [PreserveSig]
    int GetMute(out int pbMute);
}
