import AppKit
import CoreGraphics

struct FrontmostAppInfo {
    let pid: Int32
    let name: String
    let bundleId: String
}

public class AppControlBridge {
    public init() {}

    func frontmost_app() -> FrontmostAppInfo {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return FrontmostAppInfo(pid: 0, name: "Unknown", bundleId: "")
        }
        return FrontmostAppInfo(
            pid: app.processIdentifier,
            name: app.localizedName ?? "Unknown",
            bundleId: app.bundleIdentifier ?? ""
        )
    }

    public func frontmost_pid() -> Int32 {
        frontmost_app().pid
    }

    public func frontmost_bundle_id() -> String {
        frontmost_app().bundleId
    }

    public func frontmost_localized_name() -> String {
        frontmost_app().name
    }

    private func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber {
            return number.doubleValue
        }
        if let double = value as? Double {
            return double
        }
        if let int = value as? Int {
            return Double(int)
        }
        return nil
    }

    public func frontmost_window_bounds() -> CGRect? {
        let pid = frontmost_pid()
        guard pid > 0 else {
            return nil
        }

        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }

        for window in windows {
            guard let ownerPid = window[kCGWindowOwnerPID as String] as? NSNumber,
                  ownerPid.int32Value == pid else {
                continue
            }
            let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
            guard layer == 0 else {
                continue
            }
            let alpha = (window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1.0
            guard alpha > 0 else {
                continue
            }
            guard let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let x = number(bounds["X"]),
                  let y = number(bounds["Y"]),
                  let width = number(bounds["Width"]),
                  let height = number(bounds["Height"]),
                  let rect = normalizeTopLeftScreenRectForElectron(
                      CGRect(x: x, y: y, width: width, height: height)
                  ) else {
                continue
            }
            return rect
        }

        return nil
    }

    public func activate(pid: Int32) -> Bool {
        guard let app = NSRunningApplication(processIdentifier: pid) else {
            return false
        }
        return app.activate(options: [.activateAllWindows])
    }

}
