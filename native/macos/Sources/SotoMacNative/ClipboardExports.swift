@_cdecl("soto_clipboard_prepare_paste_text")
public func soto_clipboard_prepare_paste_text(_ text: UnsafePointer<UInt8>?, _ len: Int) -> Int32 {
  sotoClipboard.prepare_paste_text(utf8: text, len: len)
}

@_cdecl("soto_clipboard_restore_after_paste")
public func soto_clipboard_restore_after_paste() -> Int32 {
  sotoClipboard.restore_after_paste()
}

@_cdecl("soto_clipboard_copy_user_text")
public func soto_clipboard_copy_user_text(_ text: UnsafePointer<UInt8>?, _ len: Int) -> Int32 {
  sotoClipboard.copy_user_text(utf8: text, len: len)
}
