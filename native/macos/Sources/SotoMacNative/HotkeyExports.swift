import Foundation

private struct QueuedHookEvent {
  let flags: UInt64
  let key: UInt16
  let down: Int32
  let repeatValue: Int32
}

nonisolated(unsafe) private var gHookBridge: HookBridge?
nonisolated(unsafe) private var gHeldFlagKeys = Set<UInt16>()
nonisolated(unsafe) private var gHookEvents: [QueuedHookEvent] = []
private let gHookLock = NSLock()
private let maxQueuedHookEvents = 256
private let cgEventFlagMaskShift: UInt64 = 1 << 17
private let cgEventFlagMaskControl: UInt64 = 1 << 18
private let cgEventFlagMaskAlternate: UInt64 = 1 << 19
private let cgEventFlagMaskCommand: UInt64 = 1 << 20

private func enqueueHookEvent(_ flags: UInt64, _ keyCode: UInt16, _ down: Int32, _ repeatValue: Int32) {
  gHookLock.lock()
  if gHookEvents.count >= maxQueuedHookEvents {
    gHookEvents.removeFirst(gHookEvents.count - maxQueuedHookEvents + 1)
  }
  gHookEvents.append(
    QueuedHookEvent(flags: flags, key: keyCode, down: down, repeatValue: repeatValue)
  )
  gHookLock.unlock()
}

func soto_mac_hook_dispatch_flags(_ flags: UInt64, _ keyCode: UInt16) -> Bool {
  let mask = modifierFlagMask(keyCode)
  gHookLock.lock()
  let down: Int32
  if let mask {
    down = (flags & mask) != 0 ? 1 : 0
    if down == 1 {
      gHeldFlagKeys.insert(keyCode)
    } else {
      gHeldFlagKeys.remove(keyCode)
    }
  } else {
    if gHeldFlagKeys.contains(keyCode) {
      gHeldFlagKeys.remove(keyCode)
      down = 0
    } else {
      gHeldFlagKeys.insert(keyCode)
      down = 1
    }
  }
  gHookLock.unlock()
  enqueueHookEvent(flags, keyCode, down, 0)
  return false
}

private func modifierFlagMask(_ keyCode: UInt16) -> UInt64? {
  switch keyCode {
  case 0x38, 0x3c:
    return cgEventFlagMaskShift
  case 0x3b, 0x3e:
    return cgEventFlagMaskControl
  case 0x3a, 0x3d:
    return cgEventFlagMaskAlternate
  case 0x37, 0x36:
    return cgEventFlagMaskCommand
  default:
    return nil
  }
}

func soto_mac_hook_dispatch_key(
  _ flags: UInt64, _ keyCode: UInt16, _ edgeDown: Bool, _ isRepeat: Bool
) -> Bool {
  enqueueHookEvent(flags, keyCode, edgeDown ? 1 : 0, isRepeat ? 1 : 0)
  return false
}

@_cdecl("soto_hook_install")
public func soto_hook_install(
  _ callback: UnsafeMutableRawPointer?,
  _ user: UnsafeMutableRawPointer?
) -> UnsafeMutableRawPointer? {
  _ = callback
  _ = user

  gHookLock.lock()
  gHeldFlagKeys.removeAll()
  gHookEvents.removeAll()
  gHookLock.unlock()

  let bridge = HookBridge()
  guard bridge.install() else {
    return nil
  }
  gHookBridge = bridge
  return Unmanaged.passUnretained(bridge).toOpaque()
}

@_cdecl("soto_hook_shutdown")
public func soto_hook_shutdown(_ handle: UnsafeMutableRawPointer?) -> Int32 {
  _ = handle
  let stopped = gHookBridge?.shutdown() ?? false
  gHookBridge = nil
  gHookLock.lock()
  gHeldFlagKeys.removeAll()
  gHookEvents.removeAll()
  gHookLock.unlock()
  return stopped ? 0 : -1
}

public func soto_hook_next_event(_ out: UnsafeMutablePointer<SotoHookEventRaw>?) -> Int32 {
  guard let out else {
    return 0
  }
  gHookLock.lock()
  guard !gHookEvents.isEmpty else {
    gHookLock.unlock()
    return 0
  }
  let event = gHookEvents.removeFirst()
  gHookLock.unlock()
  out.pointee = SotoHookEventRaw(
    flags: event.flags,
    key: UInt32(event.key),
    scanCode: 0,
    down: event.down == 0 ? 0 : 1,
    repeat: event.repeatValue == 0 ? 0 : 1,
    droppedCount: 0
  )
  return 1
}

@_cdecl("soto_hook_next_event")
public func soto_hook_next_event_c(_ out: UnsafeMutableRawPointer?) -> Int32 {
  soto_hook_next_event(out?.bindMemory(to: SotoHookEventRaw.self, capacity: 1))
}
