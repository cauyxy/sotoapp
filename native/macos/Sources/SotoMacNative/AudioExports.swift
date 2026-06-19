import CoreAudio

// Media-mute via CoreAudio: toggle the DEFAULT OUTPUT DEVICE's mute flag
// (kAudioDevicePropertyMute). This silences output without changing the volume
// LEVEL and without pausing playback — unmuting restores the exact prior level.
//
// macOS has no public per-process output-mute API, so the device mute flag is
// the closest public, non-destructive lever (it does not touch the master volume
// the user sees). The @soto/core MediaMuteCoordinator saves the prior flag and
// restores it on every terminal path, so we never leave the user muted.
//
// Return codes match the koffi ABI: is_output_muted → 1 muted / 0 unmuted / -1
// error; set_output_muted → 0 ok / -1 error. A device that does not expose a
// settable mute property degrades to -1 (the TS side then simply skips muting).

private func defaultOutputDevice() -> AudioDeviceID? {
  var deviceID = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  let status = AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID
  )
  if status != noErr || deviceID == AudioDeviceID(0) { return nil }
  return deviceID
}

private func muteAddress() -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyMute,
    mScope: kAudioObjectPropertyScopeOutput,
    mElement: kAudioObjectPropertyElementMain
  )
}

@_cdecl("soto_audio_is_output_muted")
public func soto_audio_is_output_muted() -> Int32 {
  guard let device = defaultOutputDevice() else { return -1 }
  var address = muteAddress()
  if !AudioObjectHasProperty(device, &address) { return -1 }
  var muted = UInt32(0)
  var size = UInt32(MemoryLayout<UInt32>.size)
  let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &muted)
  if status != noErr { return -1 }
  return muted != 0 ? 1 : 0
}

@_cdecl("soto_audio_set_output_muted")
public func soto_audio_set_output_muted(_ muted: Int32) -> Int32 {
  guard let device = defaultOutputDevice() else { return -1 }
  var address = muteAddress()
  if !AudioObjectHasProperty(device, &address) { return -1 }
  var settable = DarwinBoolean(false)
  let canSet = AudioObjectIsPropertySettable(device, &address, &settable)
  if canSet != noErr || !settable.boolValue { return -1 }
  var value = UInt32(muted != 0 ? 1 : 0)
  let size = UInt32(MemoryLayout<UInt32>.size)
  let status = AudioObjectSetPropertyData(device, &address, 0, nil, size, &value)
  return status == noErr ? 0 : -1
}
