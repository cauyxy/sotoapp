@_cdecl("soto_ax_is_trusted")
public func soto_ax_is_trusted(_ prompt: Int32) -> Int32 {
  sotoAx.is_trusted(prompt: prompt != 0) ? 1 : 0
}

public func soto_ax_capture_focused(_ out: UnsafeMutablePointer<SotoAxContextRaw>?) -> Int32 {
  guard let out else {
    return 0
  }

  out.pointee = SotoAxContextRaw()
  let result = sotoAx.capture_focused()
  guard result == 1 else {
    return result
  }

  out.pointee.selection_start = sotoAx.captured_selection_start()
  out.pointee.selection_end = sotoAx.captured_selection_end()
  out.pointee.full_text = soto_cstr(sotoAx.captured_full_text())
  out.pointee.before = soto_cstr(sotoAx.captured_before())
  out.pointee.after = soto_cstr(sotoAx.captured_after())
  out.pointee.ax_role = soto_cstr(sotoAx.captured_ax_role())
  out.pointee.focused_element_id = nil
  return result
}

public func soto_ax_context_free(_ ctx: UnsafeMutablePointer<SotoAxContextRaw>?) -> Int32 {
  guard let ctx else {
    return 0
  }

  soto_free_cstr(ctx.pointee.full_text)
  soto_free_cstr(ctx.pointee.before)
  soto_free_cstr(ctx.pointee.after)
  soto_free_cstr(ctx.pointee.ax_role)
  soto_free_cstr(ctx.pointee.focused_element_id)
  ctx.pointee = SotoAxContextRaw()
  return 0
}

@_cdecl("soto_ax_capture_focused")
public func soto_ax_capture_focused_c(_ out: UnsafeMutableRawPointer?) -> Int32 {
  soto_ax_capture_focused(out?.bindMemory(to: SotoAxContextRaw.self, capacity: 1))
}

@_cdecl("soto_ax_context_free")
public func soto_ax_context_free_c(_ ctx: UnsafeMutableRawPointer?) -> Int32 {
  soto_ax_context_free(ctx?.bindMemory(to: SotoAxContextRaw.self, capacity: 1))
}

@_cdecl("soto_window_title")
public func soto_window_title(
  _ buffer: UnsafeMutablePointer<UInt8>?,
  _ bufferLen: Int,
  _ requiredLen: UnsafeMutablePointer<Int>?
) -> Int32 {
  let title = Array(sotoAx.focused_window_title().utf8)
  requiredLen?.pointee = title.count
  guard title.count <= Int(Int32.max),
        let buffer,
        bufferLen >= title.count else {
    return -1
  }

  if !title.isEmpty {
    buffer.update(from: title, count: title.count)
  }
  return Int32(title.count)
}
