@_cdecl("soto_send_paste")
public func soto_send_paste() -> Int32 {
  sotoInjection.send_paste()
}

@_cdecl("soto_focus_probe")
public func soto_focus_probe() -> Int32 {
  sotoInjection.focus_probe()
}
