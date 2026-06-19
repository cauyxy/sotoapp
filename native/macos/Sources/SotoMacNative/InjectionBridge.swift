import ApplicationServices
import Carbon
import CoreGraphics
import Darwin
import Foundation

let nativeAttemptOk: Int32 = 0
let nativeAttemptInvalidArgument: Int32 = -1
let nativeAttemptNotTrusted: Int32 = -3
let nativeAttemptSecureEventInput: Int32 = -4
let nativeAttemptSecureTextField: Int32 = -5
let nativeAttemptNoFocusedElement: Int32 = -6
let nativeAttemptNotEditable: Int32 = -7
let nativeAttemptEventSourceUnavailable: Int32 = -8
let nativeAttemptEventCreateFailed: Int32 = -9

func syntheticDeliveryAttemptCode(
    accessibilityTrusted: Bool,
    secureEventInputEnabled: Bool,
    focusedElementKnown: Bool,
    focusedElementIsSecureTextField: Bool
) -> Int32 {
    if !accessibilityTrusted {
        return nativeAttemptNotTrusted
    }
    if secureEventInputEnabled {
        return nativeAttemptSecureEventInput
    }
    if focusedElementKnown && focusedElementIsSecureTextField {
        return nativeAttemptSecureTextField
    }
    return nativeAttemptOk
}

func syntheticDeliveryAllowed(
    accessibilityTrusted: Bool,
    secureEventInputEnabled: Bool,
    focusedElementKnown: Bool,
    focusedElementIsSecureTextField: Bool
) -> Bool {
    syntheticDeliveryAttemptCode(
        accessibilityTrusted: accessibilityTrusted,
        secureEventInputEnabled: secureEventInputEnabled,
        focusedElementKnown: focusedElementKnown,
        focusedElementIsSecureTextField: focusedElementIsSecureTextField
    ) == nativeAttemptOk
}

public class InjectionBridge {
    private let commandKey: CGKeyCode = 0x37
    private let fallbackCKey: CGKeyCode = 0x08
    private let fallbackVKey: CGKeyCode = 0x09

    public init() {}

    public func insert_text(text: String) -> Int32 {
        guard AXIsProcessTrusted() else {
            return nativeAttemptNotTrusted
        }
        guard !IsSecureEventInputEnabled() else {
            return nativeAttemptSecureEventInput
        }
        let system = AXUIElementCreateSystemWide()
        var focusedRef: CFTypeRef?
        let focusedCode = AXUIElementCopyAttributeValue(
            system,
            kAXFocusedUIElementAttribute as CFString,
            &focusedRef
        )
        guard focusedCode == .success, let focusedRef else {
            return nativeAttemptNoFocusedElement
        }

        let focused = focusedRef as! AXUIElement
        guard !isSecureTextField(focused) else {
            return nativeAttemptSecureTextField
        }
        if AXUIElementSetAttributeValue(
            focused,
            kAXSelectedTextAttribute as CFString,
            text as CFTypeRef
        ) == .success {
            return nativeAttemptOk
        }

        guard
            let fullText = copyStringAttribute(focused, kAXValueAttribute as CFString),
            let selectedRange = copySelectedRange(focused)
        else {
            return nativeAttemptNotEditable
        }

        let utf16 = Array(fullText.utf16)
        let start = min(selectedRange.location, utf16.count)
        let end = min(max(start + selectedRange.length, start), utf16.count)
        let next =
            String(decoding: utf16[..<start], as: UTF16.self)
            + text
            + String(decoding: utf16[end...], as: UTF16.self)

        guard AXUIElementSetAttributeValue(
            focused,
            kAXValueAttribute as CFString,
            next as CFTypeRef
        ) == .success else {
            return nativeAttemptNotEditable
        }

        var nextRange = CFRange(location: start + text.utf16.count, length: 0)
        if let rangeValue = AXValueCreate(.cfRange, &nextRange) {
            _ = AXUIElementSetAttributeValue(
                focused,
                kAXSelectedTextRangeAttribute as CFString,
                rangeValue
            )
        }
        return nativeAttemptOk
    }

    public func send_paste() -> Int32 {
        sendCommandChord(keyCode: keyCodeForCharacter("v", fallback: fallbackVKey))
    }

    public func send_copy() -> Int32 {
        let preflightCode = focusedTargetSyntheticDeliveryAttemptCode()
        guard preflightCode == nativeAttemptOk else { return preflightCode }
        return sendCommandChord(keyCode: keyCodeForCharacter("c", fallback: fallbackCKey))
    }

    private func sendCommandChord(keyCode: CGKeyCode) -> Int32 {
        guard let source = CGEventSource(stateID: .hidSystemState) else {
            return nativeAttemptEventSourceUnavailable
        }
        guard
            let commandDown = CGEvent(keyboardEventSource: source, virtualKey: commandKey, keyDown: true),
            let vDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
            let vUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false),
            let commandUp = CGEvent(keyboardEventSource: source, virtualKey: commandKey, keyDown: false)
        else {
            return nativeAttemptEventCreateFailed
        }

        vDown.flags = .maskCommand
        vUp.flags = .maskCommand
        commandDown.post(tap: .cghidEventTap)
        vDown.post(tap: .cghidEventTap)
        vUp.post(tap: .cghidEventTap)
        commandUp.post(tap: .cghidEventTap)
        return nativeAttemptOk
    }

    private func keyCodeForCharacter(_ target: Character, fallback: CGKeyCode) -> CGKeyCode {
        guard
            let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
            let layoutProperty = TISGetInputSourceProperty(
                source,
                kTISPropertyUnicodeKeyLayoutData
            )
        else {
            return fallback
        }

        let layoutData = unsafeBitCast(layoutProperty, to: CFData.self)
        guard let bytes = CFDataGetBytePtr(layoutData) else {
            return fallback
        }

        return bytes.withMemoryRebound(to: UCKeyboardLayout.self, capacity: 1) { keyboardLayout in
            for keyCode in 0..<128 {
                var deadKeyState: UInt32 = 0
                var chars = [UniChar](repeating: 0, count: 4)
                var length = 0
                let status = chars.withUnsafeMutableBufferPointer { buffer in
                    UCKeyTranslate(
                        keyboardLayout,
                        UInt16(keyCode),
                        UInt16(kUCKeyActionDown),
                        0,
                        UInt32(LMGetKbdType()),
                        OptionBits(kUCKeyTranslateNoDeadKeysBit),
                        &deadKeyState,
                        buffer.count,
                        &length,
                        buffer.baseAddress
                    )
                }
                guard status == noErr, length > 0 else {
                    continue
                }
                if let scalar = UnicodeScalar(chars[0]),
                    String(scalar).lowercased() == String(target)
                {
                    return CGKeyCode(keyCode)
                }
            }

            return fallback
        }
    }

    public func focus_probe() -> Int32 {
        guard AXIsProcessTrusted() else {
            logFocusProbe("status=untrusted")
            return 3
        }
        if IsSecureEventInputEnabled() {
            logFocusProbe("status=secure_input reason=secure_event_input")
            return 5
        }
        let system = AXUIElementCreateSystemWide()
        var focusedRef: CFTypeRef?
        let focusedCode = AXUIElementCopyAttributeValue(
            system,
            kAXFocusedUIElementAttribute as CFString,
            &focusedRef
        )
        guard focusedCode == .success, let focusedRef else {
            logFocusProbe("status=no_focus ax_error=\(focusedCode.rawValue)")
            return 0
        }
        let focused = focusedRef as! AXUIElement
        if isSecureTextField(focused) {
            logFocusProbe("status=secure_input reason=secure_text_field")
            return 5
        }
        if isSettable(focused, kAXSelectedTextAttribute as CFString)
            || isSettable(focused, kAXValueAttribute as CFString)
        {
            return 1
        }
        return 2
    }

    public func type_text_chunk(text: String) -> Int32 {
        let preflightCode = focusedTargetSyntheticDeliveryAttemptCode()
        guard preflightCode == nativeAttemptOk else { return preflightCode }
        guard let source = CGEventSource(stateID: .hidSystemState) else {
            return nativeAttemptEventSourceUnavailable
        }
        let units = Array(text.utf16)
        guard !units.isEmpty else {
            return nativeAttemptOk
        }
        guard
            let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        else {
            return nativeAttemptEventCreateFailed
        }
        units.withUnsafeBufferPointer { buffer in
            down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress)
            up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress)
        }
        down.flags = []
        up.flags = []
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return nativeAttemptOk
    }

    public func capture_focused_value() -> String? {
        guard AXIsProcessTrusted(), !IsSecureEventInputEnabled(), let focused = focusedElement() else {
            return nil
        }
        guard !isSecureTextField(focused) else {
            return nil
        }
        guard isSettable(focused, kAXSelectedTextAttribute as CFString)
            || isSettable(focused, kAXValueAttribute as CFString)
        else {
            return nil
        }
        return copyStringAttribute(focused, kAXValueAttribute as CFString)
    }

    private func focusedTargetSyntheticDeliveryAttemptCode() -> Int32 {
        let accessibilityTrusted = AXIsProcessTrusted()
        let secureEventInputEnabled = IsSecureEventInputEnabled()
        guard let focused = focusedElement() else {
            return syntheticDeliveryAttemptCode(
                accessibilityTrusted: accessibilityTrusted,
                secureEventInputEnabled: secureEventInputEnabled,
                focusedElementKnown: false,
                focusedElementIsSecureTextField: false
            )
        }
        return syntheticDeliveryAttemptCode(
            accessibilityTrusted: accessibilityTrusted,
            secureEventInputEnabled: secureEventInputEnabled,
            focusedElementKnown: true,
            focusedElementIsSecureTextField: isSecureTextField(focused)
        )
    }

    private func focusedElement() -> AXUIElement? {
        let system = AXUIElementCreateSystemWide()
        var focusedRef: CFTypeRef?
        let focusedCode = AXUIElementCopyAttributeValue(
            system,
            kAXFocusedUIElementAttribute as CFString,
            &focusedRef
        )
        guard focusedCode == .success, let focusedRef else {
            return nil
        }
        return (focusedRef as! AXUIElement)
    }

    private func logFocusProbe(_ message: String) {
        guard nativeFocusDiagnosticsEnabled() else {
            return
        }
        fputs("[soto-focus-diag] native.focus_probe \(message)\n", stderr)
    }

    private func nativeFocusDiagnosticsEnabled() -> Bool {
        let env = ProcessInfo.processInfo.environment
        let profile = env["SOTO_LOG_PROFILE"]?.lowercased()
        if profile == "dev" || profile == "development" || profile == "smoke" {
            return true
        }
        if env["SOTO_LOG_LEVEL"]?.lowercased() == "debug" {
            return true
        }
        return env["ELECTRON_RENDERER_URL"] != nil
    }

    private func isSettable(_ element: AXUIElement, _ attribute: CFString) -> Bool {
        var settable = DarwinBoolean(false)
        let code = AXUIElementIsAttributeSettable(element, attribute, &settable)
        return code == .success && settable.boolValue
    }

    private func isSecureTextField(_ element: AXUIElement) -> Bool {
        copyStringAttribute(element, kAXRoleAttribute as CFString)
            == "AXSecureTextField"
    }

    private func copyStringAttribute(_ element: AXUIElement, _ attribute: CFString) -> String? {
        var value: CFTypeRef?
        let code = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard code == .success, let value else {
            return nil
        }
        return value as? String
    }

    private func copySelectedRange(_ element: AXUIElement) -> CFRange? {
        var value: CFTypeRef?
        let code = AXUIElementCopyAttributeValue(
            element,
            kAXSelectedTextRangeAttribute as CFString,
            &value
        )
        guard code == .success, let value else {
            return nil
        }
        return copyAXCFRangeValue(value)
    }
}
