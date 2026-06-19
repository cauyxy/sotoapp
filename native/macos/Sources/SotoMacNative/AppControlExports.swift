@_cdecl("soto_app_frontmost")
public func soto_app_frontmost(
  _ out: UnsafeMutableRawPointer?,
  _ buffer: UnsafeMutablePointer<UInt8>?,
  _ bufferLen: Int,
  _ requiredLen: UnsafeMutablePointer<Int>?
) -> Int32 {
  let app = sotoAppControl.frontmost_app()
  let name = Array(app.name.utf8)
  let bundle = Array(app.bundleId.utf8)
  let need = name.count + bundle.count
  requiredLen?.pointee = need

  out?.bindMemory(to: SotoAppInfoRaw.self, capacity: 1).pointee = SotoAppInfoRaw(
    pid: app.pid,
    name_len: UInt32(name.count),
    bundle_len: UInt32(bundle.count)
  )

  guard need <= Int(Int32.max),
        let buffer,
        bufferLen >= need else {
    return -1
  }

  if !name.isEmpty {
    buffer.update(from: name, count: name.count)
  }
  if !bundle.isEmpty {
    buffer.advanced(by: name.count).update(from: bundle, count: bundle.count)
  }
  return Int32(need)
}

@_cdecl("soto_app_frontmost_window_bounds")
public func soto_app_frontmost_window_bounds(_ out: UnsafeMutableRawPointer?) -> Int32 {
  guard let out else {
    return -1
  }
  guard let rect = sotoAppControl.frontmost_window_bounds() else {
    out.bindMemory(to: SotoRectRaw.self, capacity: 1).pointee = SotoRectRaw()
    return 0
  }

  out.bindMemory(to: SotoRectRaw.self, capacity: 1).pointee = SotoRectRaw(
    x: rect.origin.x,
    y: rect.origin.y,
    width: rect.width,
    height: rect.height
  )
  return 1
}

@_cdecl("soto_app_activate")
public func soto_app_activate(_ pid: Int32) -> Int32 {
  sotoAppControl.activate(pid: pid) ? 0 : -1
}
