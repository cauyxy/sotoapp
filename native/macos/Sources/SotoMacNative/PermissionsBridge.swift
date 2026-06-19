import ApplicationServices
import AppKit
import AVFoundation
import CoreGraphics
import Dispatch

public class PermissionsBridge {
    public init() {}

    public func microphone_authorization_status() -> Int32 {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .notDetermined:
            return 0
        case .restricted:
            return 1
        case .denied:
            return 2
        case .authorized:
            return 3
        @unknown default:
            return -1
        }
    }

    public func accessibility_is_trusted() -> Bool {
        AXIsProcessTrusted()
    }

    public func screen_recording_authorization_status() -> Int32 {
        CGPreflightScreenCaptureAccess() ? 3 : 2
    }

    public func request_microphone_authorization() -> Int32 {
        let semaphore = DispatchSemaphore(value: 0)
        AVCaptureDevice.requestAccess(for: .audio) { _ in
            semaphore.signal()
        }
        let waitResult = semaphore.wait(timeout: .now() + 60)
        if waitResult == .timedOut {
            return -1
        }
        return microphone_authorization_status()
    }

    public func request_accessibility_authorization() -> Bool {
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    public func request_screen_recording_authorization() -> Int32 {
        CGRequestScreenCaptureAccess() ? 3 : screen_recording_authorization_status()
    }

    public func open_permission_settings(pane: Int32) -> Bool {
        let urlString: String
        switch pane {
        case 0:
            urlString =
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        case 1:
            urlString =
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        case 2:
            urlString =
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        default:
            return false
        }

        guard let url = URL(string: urlString) else {
            return false
        }
        return NSWorkspace.shared.open(url)
    }
}
