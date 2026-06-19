@_cdecl("soto_permission_status_kind")
public func soto_permission_status_kind(_ pane: Int32) -> Int32 {
  switch pane {
  case 0:
    return sotoPermissions.microphone_authorization_status()
  case 1:
    return sotoPermissions.accessibility_is_trusted() ? 3 : 2
  default:
    return -1
  }
}

@_cdecl("soto_request_permission")
public func soto_request_permission(_ pane: Int32) -> Int32 {
  switch pane {
  case 0:
    return sotoPermissions.request_microphone_authorization()
  case 1:
    return sotoPermissions.request_accessibility_authorization() ? 3 : 2
  default:
    return -1
  }
}

@_cdecl("soto_open_permission_settings")
public func soto_open_permission_settings(_ pane: Int32) -> Int32 {
  sotoPermissions.open_permission_settings(pane: pane) ? 0 : -1
}
