import Foundation

nonisolated(unsafe) let sotoAppControl = AppControlBridge()
nonisolated(unsafe) let sotoClipboard = ClipboardBridge()
nonisolated(unsafe) let sotoAx = AxBridge()
nonisolated(unsafe) let sotoInjection = InjectionBridge()
nonisolated(unsafe) let sotoPermissions = PermissionsBridge()

func soto_cstr(_ value: String) -> UnsafeMutablePointer<CChar>? {
  value.withCString { strdup($0) }
}

public struct SotoHookEventRaw {
  public var flags: UInt64 = 0
  public var key: UInt32 = 0
  public var scanCode: UInt32 = 0
  public var down: UInt8 = 0
  public var `repeat`: UInt8 = 0
  public var droppedCount: UInt32 = 0
}

public struct SotoAxContextRaw {
  public var selection_start: UInt32 = 0
  public var selection_end: UInt32 = 0
  public var full_text: UnsafeMutablePointer<CChar>? = nil
  public var before: UnsafeMutablePointer<CChar>? = nil
  public var after: UnsafeMutablePointer<CChar>? = nil
  public var ax_role: UnsafeMutablePointer<CChar>? = nil
  public var focused_element_id: UnsafeMutablePointer<CChar>? = nil
}

public struct SotoAppInfoRaw {
  public var pid: Int32 = 0
  public var name_len: UInt32 = 0
  public var bundle_len: UInt32 = 0
}

public struct SotoRectRaw {
  public var x: Double = 0
  public var y: Double = 0
  public var width: Double = 0
  public var height: Double = 0
}

public struct TextAnchorRaw {
  public var source: Int32 = 0
  public var x: Double = 0
  public var y: Double = 0
  public var width: Double = 0
  public var height: Double = 0
}

func soto_free_cstr(_ ptr: UnsafeMutablePointer<CChar>?) {
  if let ptr { free(ptr) }
}
