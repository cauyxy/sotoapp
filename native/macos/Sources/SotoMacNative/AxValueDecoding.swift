import ApplicationServices
import CoreGraphics

private let coordinateTolerance = 0.5
private let caretFallbackTolerance = 2.0

struct TextAnchorRangeCandidate {
    let range: CFRange
    let allowDegenerate: Bool
}

func copyAXCFRangeValue(_ value: CFTypeRef?) -> CFRange? {
    guard let axValue = checkedAXValue(value, type: .cfRange) else {
        return nil
    }

    var range = CFRange(location: 0, length: 0)
    guard AXValueGetValue(axValue, .cfRange, &range),
          range.location >= 0,
          range.length >= 0 else {
        return nil
    }
    let location = UInt64(range.location)
    let length = UInt64(range.length)
    let max = UInt64(UInt32.max)
    guard location <= max,
          length <= max,
          location + length <= max else {
        return nil
    }
    return range
}

func copyAXCGRectValue(_ value: CFTypeRef?) -> CGRect? {
    guard let axValue = checkedAXValue(value, type: .cgRect) else {
        return nil
    }

    var rect = CGRect.zero
    guard AXValueGetValue(axValue, .cgRect, &rect) else {
        return nil
    }
    return rect
}

func copyAXCGPointValue(_ value: CFTypeRef?) -> CGPoint? {
    guard let axValue = checkedAXValue(value, type: .cgPoint) else {
        return nil
    }

    var point = CGPoint.zero
    guard AXValueGetValue(axValue, .cgPoint, &point) else {
        return nil
    }
    return point
}

func copyAXCGSizeValue(_ value: CFTypeRef?) -> CGSize? {
    guard let axValue = checkedAXValue(value, type: .cgSize) else {
        return nil
    }

    var size = CGSize.zero
    guard AXValueGetValue(axValue, .cgSize, &size) else {
        return nil
    }
    return size
}

func normalizeAXRectForElectron(_ rect: CGRect, allowDegenerate: Bool) -> CGRect? {
    guard rect.origin.x.isFinite,
          rect.origin.y.isFinite,
          rect.width.isFinite,
          rect.height.isFinite,
          rect.width >= 0,
          rect.height >= 0 else {
        return nil
    }

    if allowDegenerate {
        guard rect.height > 0 else {
            return nil
        }
    } else {
        guard rect.width > 0, rect.height > 0 else {
            return nil
        }
    }

    return CGRect(
        x: rect.origin.x,
        y: rect.origin.y,
        width: max(rect.width, 1),
        height: max(rect.height, 1)
    )
}

func convertAXRectToElectronGlobal(
    _ rect: CGRect,
    zeroScreenFrame: CGRect,
    allowDegenerate: Bool
) -> CGRect? {
    guard let normalized = normalizeAXRectForElectron(
        rect,
        allowDegenerate: allowDegenerate
    ) else {
        return nil
    }

    let electronY = zeroScreenFrame.origin.y
        + zeroScreenFrame.height
        - normalized.origin.y
        - normalized.height

    return CGRect(
        x: normalized.origin.x,
        y: electronY,
        width: normalized.width,
        height: normalized.height
    )
}

func zeroScreenFrameForElectronConversion(_ screenFrames: [CGRect]) -> CGRect? {
    screenFrames.first { frame in
        frame.origin.x.isFinite
            && frame.origin.y.isFinite
            && frame.width.isFinite
            && frame.height.isFinite
            && frame.width > 0
            && frame.height > 0
            && abs(frame.origin.x) <= coordinateTolerance
            && abs(frame.origin.y) <= coordinateTolerance
    }
}

func adjacentCaretFallbackIsCompatible(collapsed: CGRect, adjacent: CGRect) -> Bool {
    guard let caretPoint = collapsedCaretPoint(from: collapsed),
          let normalizedAdjacent = normalizeAXRectForElectron(
              adjacent,
              allowDegenerate: false
          ) else {
        return false
    }

    return caretPoint.x >= normalizedAdjacent.minX - caretFallbackTolerance
        && caretPoint.x <= normalizedAdjacent.maxX + caretFallbackTolerance
        && caretPoint.y >= normalizedAdjacent.minY - caretFallbackTolerance
        && caretPoint.y <= normalizedAdjacent.maxY + caretFallbackTolerance
}

func synthesizeCollapsedCaretRect(collapsed: CGRect, adjacent: CGRect) -> CGRect? {
    guard let caretPoint = collapsedCaretPoint(from: collapsed),
          adjacentCaretFallbackIsCompatible(collapsed: collapsed, adjacent: adjacent),
          let normalizedAdjacent = normalizeAXRectForElectron(
              adjacent,
              allowDegenerate: false
          ) else {
        return nil
    }

    let caretWidth = 1.0
    return CGRect(
        x: caretPoint.x - caretWidth / 2,
        y: normalizedAdjacent.origin.y,
        width: caretWidth,
        height: normalizedAdjacent.height
    )
}

func synthesizeExactCollapsedCaretRect(_ rect: CGRect) -> CGRect? {
    guard let caretPoint = collapsedCaretPoint(from: rect),
          rect.height > 0 else {
        return nil
    }

    let caretWidth = 1.0
    return CGRect(
        x: caretPoint.x - caretWidth / 2,
        y: rect.origin.y,
        width: caretWidth,
        height: rect.height
    )
}

func collapsedCaretPoint(from rect: CGRect) -> CGPoint? {
    guard rect.origin.x.isFinite,
          rect.origin.y.isFinite,
          rect.width.isFinite,
          rect.height.isFinite,
          rect.width >= 0,
          rect.width <= caretFallbackTolerance,
          rect.height >= 0 else {
        return nil
    }

    return CGPoint(x: rect.midX, y: rect.midY)
}

func normalizeAXFocusedElementRect(point: CGPoint, size: CGSize) -> CGRect? {
    guard point.x.isFinite,
          point.y.isFinite,
          size.width.isFinite,
          size.height.isFinite,
          size.width > 0,
          size.height > 0 else {
        return nil
    }

    return CGRect(origin: point, size: size)
}

func textAnchorRangeCandidates(for selectedRange: CFRange) -> [TextAnchorRangeCandidate] {
    guard selectedRange.length == 0 else {
        return [TextAnchorRangeCandidate(range: selectedRange, allowDegenerate: false)]
    }

    var candidates = [
        TextAnchorRangeCandidate(range: selectedRange, allowDegenerate: true),
    ]
    if selectedRange.location > 0 {
        candidates.append(
            TextAnchorRangeCandidate(
                range: CFRange(location: selectedRange.location - 1, length: 1),
                allowDegenerate: false
            )
        )
    }
    candidates.append(
        TextAnchorRangeCandidate(
            range: CFRange(location: selectedRange.location, length: 1),
            allowDegenerate: false
        )
    )
    return candidates
}

func normalizeTopLeftScreenRectForElectron(_ rect: CGRect) -> CGRect? {
    guard rect.origin.x.isFinite,
          rect.origin.y.isFinite,
          rect.width.isFinite,
          rect.height.isFinite,
          rect.width > 1,
          rect.height > 1 else {
        return nil
    }

    return rect
}

func formatElectronRectString(_ rect: CGRect) -> String {
    "\(rect.origin.x),\(rect.origin.y),\(rect.width),\(rect.height)"
}

private func checkedAXValue(_ value: CFTypeRef?, type: AXValueType) -> AXValue? {
    guard let value,
          CFGetTypeID(value) == AXValueGetTypeID() else {
        return nil
    }

    // Swift rejects conditional casts for CF types, so gate by CFTypeID first.
    let axValue = value as! AXValue
    guard AXValueGetType(axValue) == type else {
        return nil
    }
    return axValue
}
