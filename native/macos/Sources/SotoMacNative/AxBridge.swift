import ApplicationServices
import AppKit
import Carbon

public class AxBridge {
    private let contextUTF16Units = 512
    private let textAnchorAvailable: Int32 = 1
    private let textAnchorNoFocusedElement: Int32 = 0
    private let textAnchorNotTrusted: Int32 = -1
    private let textAnchorUnsupported: Int32 = -2
    private let textAnchorNoSelectedRange: Int32 = -3
    private let textAnchorSecureInput: Int32 = -5
    private let textAnchorError: Int32 = -100

    private struct CapturedContext {
        let fullText: String
        let selectionStart: UInt32
        let selectionEnd: UInt32
        let before: String
        let after: String
        let axRole: String
    }

    private var capturedContext: CapturedContext?

    public init() {}

    public func is_trusted(prompt: Bool) -> Bool {
        if !prompt {
            return AXIsProcessTrusted()
        }

        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    public func capture_focused() -> Int32 {
        capturedContext = nil

        if !AXIsProcessTrusted() {
            return -1
        }

        let system = AXUIElementCreateSystemWide()
        var focusedRef: CFTypeRef?
        let focusedCode = AXUIElementCopyAttributeValue(
            system,
            kAXFocusedUIElementAttribute as CFString,
            &focusedRef
        )

        if focusedCode == .apiDisabled {
            return -1
        }
        guard focusedCode == .success, let focusedRef else {
            return 0
        }

        let focused = focusedRef as! AXUIElement
        if IsSecureEventInputEnabled() {
            return 0
        }
        let axRole = copyStringAttribute(focused, kAXRoleAttribute as CFString) ?? ""
        if axRole == "AXSecureTextField" {
            return 0
        }
        guard let fullText = copyStringAttribute(focused, kAXValueAttribute as CFString) else {
            return 0
        }

        let selectedRange = copySelectedRange(focused) ?? (0, 0)
        capturedContext = buildContext(
            fullText: fullText,
            selectionStart: selectedRange.0,
            selectionEnd: selectedRange.1,
            axRole: axRole
        )
        return 1
    }

    public func caret_bounds() -> String {
        if !AXIsProcessTrusted() || IsSecureEventInputEnabled() {
            return ""
        }
        guard let focused = copyFocusedElement() else {
            return ""
        }
        let axRole = copyStringAttribute(focused, kAXRoleAttribute as CFString) ?? ""
        guard axRole != "AXSecureTextField",
              let selectedRange = copySelectedCFRange(focused) else {
            return ""
        }

        guard let rect = copyTextAnchorBounds(focused, selectedRange) else {
            return ""
        }
        return formatElectronRectString(rect)
    }

    public func text_anchor(_ outAnchor: UnsafeMutablePointer<TextAnchorRaw>?) -> Int32 {
        guard let outAnchor else {
            return textAnchorError
        }
        outAnchor.pointee = TextAnchorRaw()

        if !AXIsProcessTrusted() {
            return textAnchorNotTrusted
        }
        if IsSecureEventInputEnabled() {
            return textAnchorSecureInput
        }
        guard let focused = copyFocusedElement() else {
            return textAnchorNoFocusedElement
        }
        let axRole = copyStringAttribute(focused, kAXRoleAttribute as CFString) ?? ""
        if axRole == "AXSecureTextField" {
            return textAnchorSecureInput
        }
        guard let selectedRange = copySelectedCFRange(focused) else {
            if let rect = copyFocusedElementBounds(focused) {
                fillTextAnchor(outAnchor, source: 3, rect: rect)
                return textAnchorAvailable
            }
            return textAnchorNoSelectedRange
        }

        if let rect = copyTextAnchorBounds(focused, selectedRange) {
            fillTextAnchor(
                outAnchor,
                source: selectedRange.length > 0 ? 2 : 1,
                rect: rect
            )
            return textAnchorAvailable
        }

        if let rect = copyFocusedElementBounds(focused) {
            fillTextAnchor(outAnchor, source: 3, rect: rect)
            return textAnchorAvailable
        }

        return textAnchorUnsupported
    }

    public func focused_window_title() -> String {
        if !AXIsProcessTrusted() {
            return ""
        }
        let system = AXUIElementCreateSystemWide()
        var windowRef: CFTypeRef?
        let code = AXUIElementCopyAttributeValue(
            system,
            kAXFocusedWindowAttribute as CFString,
            &windowRef
        )
        guard code == .success, let windowRef else {
            return ""
        }
        let window = windowRef as! AXUIElement
        return copyStringAttribute(window, kAXTitleAttribute as CFString) ?? ""
    }

    public func captured_full_text() -> String {
        capturedContext?.fullText ?? ""
    }

    public func captured_selection_start() -> UInt32 {
        capturedContext?.selectionStart ?? 0
    }

    public func captured_selection_end() -> UInt32 {
        capturedContext?.selectionEnd ?? 0
    }

    public func captured_before() -> String {
        capturedContext?.before ?? ""
    }

    public func captured_after() -> String {
        capturedContext?.after ?? ""
    }

    public func captured_ax_role() -> String {
        capturedContext?.axRole ?? ""
    }

    private func copyFocusedElement() -> AXUIElement? {
        let system = AXUIElementCreateSystemWide()
        var focusedRef: CFTypeRef?
        let code = AXUIElementCopyAttributeValue(
            system,
            kAXFocusedUIElementAttribute as CFString,
            &focusedRef
        )
        guard code == .success, let focusedRef else {
            return nil
        }
        return (focusedRef as! AXUIElement)
    }

    private func copyStringAttribute(_ element: AXUIElement, _ attribute: CFString) -> String? {
        var value: CFTypeRef?
        let code = AXUIElementCopyAttributeValue(element, attribute, &value)
        guard code == .success, let value else {
            return nil
        }
        return value as? String
    }

    private func copySelectedRange(_ element: AXUIElement) -> (UInt32, UInt32)? {
        guard let range = copySelectedCFRange(element) else {
            return nil
        }

        let start = UInt32(range.location)
        let end = UInt32(range.location + range.length)
        return (start, end)
    }

    private func copySelectedCFRange(_ element: AXUIElement) -> CFRange? {
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

    private func copyTextAnchorBounds(_ element: AXUIElement, _ range: CFRange) -> CGRect? {
        let candidates = textAnchorRangeCandidates(for: range)
        guard range.length == 0 else {
            guard let candidate = candidates.first else {
                return nil
            }
            return copyBoundsForRange(
                element,
                candidate.range,
                allowDegenerate: candidate.allowDegenerate
            )
        }

        guard let exactCandidate = candidates.first,
              let exactRawRect = copyRawBoundsForRange(element, exactCandidate.range) else {
            return nil
        }
        if let exactCaretRect = synthesizeExactCollapsedCaretRect(exactRawRect),
           let exactRect = electronRect(
               from: exactCaretRect,
               allowDegenerate: false
        ) {
            return exactRect
        }

        for candidate in candidates.dropFirst() {
            guard let rawRect = copyRawBoundsForRange(element, candidate.range),
                  let caretRect = synthesizeCollapsedCaretRect(
                      collapsed: exactRawRect,
                      adjacent: rawRect
                  ) else {
                continue
            }
            if let rect = electronRect(from: caretRect, allowDegenerate: false) {
                return rect
            }
        }
        return nil
    }

    private func copyBoundsForRange(
        _ element: AXUIElement,
        _ range: CFRange,
        allowDegenerate: Bool
    ) -> CGRect? {
        guard let rect = copyRawBoundsForRange(element, range) else {
            return nil
        }
        return electronRect(from: rect, allowDegenerate: allowDegenerate)
    }

    private func copyRawBoundsForRange(_ element: AXUIElement, _ range: CFRange) -> CGRect? {
        var selectedRange = range
        guard let rangeValue = AXValueCreate(.cfRange, &selectedRange) else {
            return nil
        }

        var value: CFTypeRef?
        let code = AXUIElementCopyParameterizedAttributeValue(
            element,
            kAXBoundsForRangeParameterizedAttribute as CFString,
            rangeValue,
            &value
        )
        guard code == .success, let value else {
            return nil
        }
        guard let rect = copyAXCGRectValue(value) else {
            return nil
        }
        return rect
    }

    private func copyFocusedElementBounds(_ element: AXUIElement) -> CGRect? {
        var positionRef: CFTypeRef?
        var sizeRef: CFTypeRef?
        let positionCode = AXUIElementCopyAttributeValue(
            element,
            kAXPositionAttribute as CFString,
            &positionRef
        )
        let sizeCode = AXUIElementCopyAttributeValue(
            element,
            kAXSizeAttribute as CFString,
            &sizeRef
        )
        guard positionCode == .success,
              sizeCode == .success,
              let positionRef,
              let sizeRef else {
            return nil
        }
        guard let point = copyAXCGPointValue(positionRef),
              let size = copyAXCGSizeValue(sizeRef) else {
            return nil
        }
        guard let rect = normalizeAXFocusedElementRect(point: point, size: size) else {
            return nil
        }
        return electronRect(from: rect)
    }

    private func fillTextAnchor(
        _ outAnchor: UnsafeMutablePointer<TextAnchorRaw>,
        source: Int32,
        rect: CGRect
    ) {
        outAnchor.pointee.source = source
        outAnchor.pointee.x = rect.origin.x
        outAnchor.pointee.y = rect.origin.y
        outAnchor.pointee.width = rect.width
        outAnchor.pointee.height = rect.height
    }

    private func electronRect(from rect: CGRect, allowDegenerate: Bool = false) -> CGRect? {
        let screenFrames = NSScreen.screens.map(\.frame)
        guard let zeroScreenFrame = zeroScreenFrameForElectronConversion(screenFrames) else {
            return nil
        }

        return convertAXRectToElectronGlobal(
            rect,
            zeroScreenFrame: zeroScreenFrame,
            allowDegenerate: allowDegenerate
        )
    }

    private func buildContext(
        fullText: String,
        selectionStart: UInt32,
        selectionEnd: UInt32,
        axRole: String
    ) -> CapturedContext {
        let utf16 = Array(fullText.utf16)
        let textLength = UInt32(utf16.count)
        let start = min(selectionStart, textLength)
        let end = min(max(selectionEnd, start), textLength)
        let beforeStart = start > contextUTF16Units ? start - UInt32(contextUTF16Units) : 0
        let afterEnd = min(UInt32(utf16.count), end + UInt32(contextUTF16Units))
        let localStart = start - beforeStart
        let localEnd = end - beforeStart
        let windowText = String(
            decoding: utf16[Int(beforeStart)..<Int(afterEnd)],
            as: UTF16.self
        )

        let before = String(
            decoding: utf16[Int(beforeStart)..<Int(start)],
            as: UTF16.self
        )
        let after = String(
            decoding: utf16[Int(end)..<Int(afterEnd)],
            as: UTF16.self
        )

        return CapturedContext(
            fullText: windowText,
            selectionStart: localStart,
            selectionEnd: localEnd,
            before: before,
            after: after,
            axRole: axRole
        )
    }
}
