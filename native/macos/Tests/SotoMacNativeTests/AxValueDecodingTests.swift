import ApplicationServices
import CoreGraphics
import XCTest
@testable import SotoMacNative

final class AxValueDecodingTests: XCTestCase {
    func testRejectsNonAXValueCFTypes() {
        let value = "not an AXValue" as CFTypeRef

        XCTAssertNil(copyAXCFRangeValue(value))
        XCTAssertNil(copyAXCGRectValue(value))
        XCTAssertNil(copyAXCGPointValue(value))
        XCTAssertNil(copyAXCGSizeValue(value))
    }

    func testRejectsWrongAXValueTypes() {
        var point = CGPoint(x: 10, y: 20)
        let pointValue = AXValueCreate(.cgPoint, &point)!

        XCTAssertNil(copyAXCFRangeValue(pointValue))
        XCTAssertNil(copyAXCGRectValue(pointValue))
        XCTAssertNil(copyAXCGSizeValue(pointValue))
    }

    func testDecodesExpectedAXValueTypes() {
        var range = CFRange(location: 3, length: 5)
        var rect = CGRect(x: 1, y: 2, width: 30, height: 40)
        var point = CGPoint(x: 10, y: 20)
        var size = CGSize(width: 100, height: 50)

        let decodedRange = copyAXCFRangeValue(AXValueCreate(.cfRange, &range)!)
        XCTAssertEqual(decodedRange?.location, range.location)
        XCTAssertEqual(decodedRange?.length, range.length)
        XCTAssertEqual(copyAXCGRectValue(AXValueCreate(.cgRect, &rect)!), rect)
        XCTAssertEqual(copyAXCGPointValue(AXValueCreate(.cgPoint, &point)!), point)
        XCTAssertEqual(copyAXCGSizeValue(AXValueCreate(.cgSize, &size)!), size)
    }

    func testRejectsNegativeRanges() {
        var negativeLocation = CFRange(location: -1, length: 2)
        var negativeLength = CFRange(location: 1, length: -2)

        XCTAssertNil(copyAXCFRangeValue(AXValueCreate(.cfRange, &negativeLocation)!))
        XCTAssertNil(copyAXCFRangeValue(AXValueCreate(.cfRange, &negativeLength)!))
    }

    func testRejectsRangesThatCannotRoundTripThroughUInt32() {
        var locationTooLarge = CFRange(location: Int(UInt32.max) + 1, length: 0)
        var lengthTooLarge = CFRange(location: 0, length: Int(UInt32.max) + 1)
        var endTooLarge = CFRange(location: Int(UInt32.max), length: 1)

        XCTAssertNil(copyAXCFRangeValue(AXValueCreate(.cfRange, &locationTooLarge)!))
        XCTAssertNil(copyAXCFRangeValue(AXValueCreate(.cfRange, &lengthTooLarge)!))
        XCTAssertNil(copyAXCFRangeValue(AXValueCreate(.cfRange, &endTooLarge)!))
    }

    func testRejectsMalformedAXRectsUnlessDegenerateCaretIsAllowed() {
        XCTAssertNil(normalizeAXRectForElectron(CGRect(x: 1, y: 2, width: 0, height: 10), allowDegenerate: false))
        XCTAssertNil(normalizeAXRectForElectron(CGRect(x: 1, y: 2, width: 10, height: 0), allowDegenerate: false))
        XCTAssertNil(normalizeAXFocusedElementRect(point: CGPoint(x: 1, y: 2), size: CGSize(width: -1, height: 10)))
        XCTAssertNil(normalizeAXFocusedElementRect(point: CGPoint(x: 1, y: 2), size: CGSize(width: 10, height: -1)))

        XCTAssertEqual(
            normalizeAXRectForElectron(CGRect(x: 1, y: 2, width: 0, height: 10), allowDegenerate: true),
            CGRect(x: 1, y: 2, width: 1, height: 10)
        )
        XCTAssertNil(normalizeAXRectForElectron(CGRect(x: 1, y: 2, width: 0, height: 0), allowDegenerate: true))
        XCTAssertNil(normalizeAXRectForElectron(CGRect(x: 1, y: 2, width: 10, height: 0), allowDegenerate: true))
    }

    func testConvertsAXRectsToGlobalElectronCoordinates() {
        let zeroFrame = CGRect(x: 0, y: 0, width: 1440, height: 900)

        XCTAssertEqual(
            convertAXRectToElectronGlobal(
                CGRect(x: 100, y: 100, width: 50, height: 20),
                zeroScreenFrame: zeroFrame,
                allowDegenerate: false
            ),
            CGRect(x: 100, y: 780, width: 50, height: 20)
        )
        XCTAssertEqual(
            convertAXRectToElectronGlobal(
                CGRect(x: 100, y: 1_000, width: 50, height: 20),
                zeroScreenFrame: zeroFrame,
                allowDegenerate: false
            ),
            CGRect(x: 100, y: -120, width: 50, height: 20)
        )
        XCTAssertEqual(
            convertAXRectToElectronGlobal(
                CGRect(x: 100, y: -800, width: 50, height: 20),
                zeroScreenFrame: zeroFrame,
                allowDegenerate: false
            ),
            CGRect(x: 100, y: 1_680, width: 50, height: 20)
        )
    }

    func testSelectsZeroScreenFrameForGlobalElectronConversion() {
        let zeroFrame = CGRect(x: 0, y: 0, width: 1440, height: 900)
        let keyWindowFrame = CGRect(x: 0, y: 900, width: 1440, height: 900)
        let axRect = CGRect(x: 100, y: 1_000, width: 50, height: 20)

        XCTAssertEqual(
            zeroScreenFrameForElectronConversion([zeroFrame, keyWindowFrame]),
            zeroFrame
        )
        XCTAssertEqual(
            convertAXRectToElectronGlobal(
                axRect,
                zeroScreenFrame: zeroFrame,
                allowDegenerate: false
            ),
            CGRect(x: 100, y: -120, width: 50, height: 20)
        )
        XCTAssertNotEqual(
            convertAXRectToElectronGlobal(
                axRect,
                zeroScreenFrame: keyWindowFrame,
                allowDegenerate: false
            ),
            CGRect(x: 100, y: -120, width: 50, height: 20)
        )
    }

    func testSelectsOriginZeroScreenFrameWhenItIsNotFirst() {
        let keyWindowFrame = CGRect(x: 0, y: 900, width: 1440, height: 900)
        let zeroFrame = CGRect(x: 0, y: 0, width: 1440, height: 900)
        let leftFrame = CGRect(x: -1280, y: 0, width: 1280, height: 720)
        let axRect = CGRect(x: 100, y: 1_000, width: 50, height: 20)

        XCTAssertEqual(
            zeroScreenFrameForElectronConversion([keyWindowFrame, leftFrame, zeroFrame]),
            zeroFrame
        )
        XCTAssertEqual(
            convertAXRectToElectronGlobal(
                axRect,
                zeroScreenFrame: zeroFrame,
                allowDegenerate: false
            ),
            CGRect(x: 100, y: -120, width: 50, height: 20)
        )
        XCTAssertNil(
            zeroScreenFrameForElectronConversion([keyWindowFrame, leftFrame])
        )
    }

    func testAdjacentCaretFallbackRequiresCompatibleGeometry() {
        let collapsed = CGRect(x: 10, y: 20, width: 0, height: 0)

        XCTAssertTrue(
            adjacentCaretFallbackIsCompatible(
                collapsed: collapsed,
                adjacent: CGRect(x: 0, y: 15, width: 10, height: 10)
            )
        )
        XCTAssertTrue(
            adjacentCaretFallbackIsCompatible(
                collapsed: collapsed,
                adjacent: CGRect(x: 10, y: 15, width: 8, height: 10)
            )
        )
        XCTAssertFalse(
            adjacentCaretFallbackIsCompatible(
                collapsed: collapsed,
                adjacent: CGRect(x: 0, y: 35, width: 10, height: 10)
            )
        )
        XCTAssertFalse(
            adjacentCaretFallbackIsCompatible(
                collapsed: collapsed,
                adjacent: CGRect(x: 30, y: 15, width: 10, height: 10)
            )
        )
        XCTAssertFalse(
            adjacentCaretFallbackIsCompatible(
                collapsed: collapsed,
                adjacent: CGRect(x: 0, y: 15, width: 10, height: 0)
            )
        )
    }

    func testAdjacentCaretFallbackRejectsWideCollapsedRects() {
        let wideCollapsed = CGRect(x: 0, y: 20, width: 40, height: 0)
        let previousCharacter = CGRect(x: 0, y: 15, width: 30, height: 10)

        XCTAssertFalse(
            adjacentCaretFallbackIsCompatible(
                collapsed: wideCollapsed,
                adjacent: previousCharacter
            )
        )
        XCTAssertNil(
            synthesizeCollapsedCaretRect(
                collapsed: wideCollapsed,
                adjacent: previousCharacter
            )
        )
    }

    func testSynthesizesExactCollapsedCaretRect() {
        let exactCollapsed = CGRect(x: 20, y: 15, width: 0, height: 12)

        let caretRect = synthesizeExactCollapsedCaretRect(exactCollapsed)

        XCTAssertEqual(caretRect, CGRect(x: 19.5, y: 15, width: 1, height: 12))
        XCTAssertEqual(caretRect?.midX, exactCollapsed.midX)
    }

    func testRejectsWideExactCollapsedCaretRect() {
        let wideExactCollapsed = CGRect(x: 0, y: 15, width: 80, height: 20)

        XCTAssertNil(synthesizeExactCollapsedCaretRect(wideExactCollapsed))
    }

    func testSynthesizesCollapsedCaretRectFromPreviousCharacterFallback() {
        let collapsed = CGRect(x: 20, y: 20, width: 0, height: 0)
        let previousCharacter = CGRect(x: 10, y: 15, width: 10, height: 12)

        let caretRect = synthesizeCollapsedCaretRect(
            collapsed: collapsed,
            adjacent: previousCharacter
        )

        XCTAssertEqual(caretRect, CGRect(x: 19.5, y: 15, width: 1, height: 12))
        XCTAssertEqual(caretRect?.midX, collapsed.midX)
    }

    func testSynthesizesCollapsedCaretRectFromNextCharacterFallback() {
        let collapsed = CGRect(x: 20, y: 20, width: 0, height: 0)
        let nextCharacter = CGRect(x: 20, y: 15, width: 8, height: 12)

        let caretRect = synthesizeCollapsedCaretRect(
            collapsed: collapsed,
            adjacent: nextCharacter
        )

        XCTAssertEqual(caretRect, CGRect(x: 19.5, y: 15, width: 1, height: 12))
        XCTAssertEqual(caretRect?.midX, collapsed.midX)
    }

    func testSynthesizedCollapsedCaretRectDoesNotUseWideGlyphCenter() {
        let collapsed = CGRect(x: 120, y: 20, width: 0, height: 0)
        let widePreviousCharacter = CGRect(x: 0, y: 15, width: 120, height: 12)

        let caretRect = synthesizeCollapsedCaretRect(
            collapsed: collapsed,
            adjacent: widePreviousCharacter
        )

        XCTAssertEqual(caretRect, CGRect(x: 119.5, y: 15, width: 1, height: 12))
        XCTAssertNotEqual(caretRect?.midX, widePreviousCharacter.midX)
    }

    func testCollapsedCaretRangeCandidatesTryExactPreviousThenNextCharacter() {
        let candidates = textAnchorRangeCandidates(for: CFRange(location: 5, length: 0))

        XCTAssertEqual(candidates.count, 3)
        XCTAssertEqual(candidates[0].range.location, 5)
        XCTAssertEqual(candidates[0].range.length, 0)
        XCTAssertTrue(candidates[0].allowDegenerate)
        XCTAssertEqual(candidates[1].range.location, 4)
        XCTAssertEqual(candidates[1].range.length, 1)
        XCTAssertFalse(candidates[1].allowDegenerate)
        XCTAssertEqual(candidates[2].range.location, 5)
        XCTAssertEqual(candidates[2].range.length, 1)
        XCTAssertFalse(candidates[2].allowDegenerate)
    }

    func testCollapsedCaretRangeCandidatesDoNotTryNegativePreviousCharacter() {
        let candidates = textAnchorRangeCandidates(for: CFRange(location: 0, length: 0))

        XCTAssertEqual(candidates.count, 2)
        XCTAssertEqual(candidates[0].range.location, 0)
        XCTAssertEqual(candidates[0].range.length, 0)
        XCTAssertTrue(candidates[0].allowDegenerate)
        XCTAssertEqual(candidates[1].range.location, 0)
        XCTAssertEqual(candidates[1].range.length, 1)
        XCTAssertFalse(candidates[1].allowDegenerate)
    }

    func testSelectedRangeCandidatesUseOnlyTheSelectionBounds() {
        let candidates = textAnchorRangeCandidates(for: CFRange(location: 2, length: 3))

        XCTAssertEqual(candidates.count, 1)
        XCTAssertEqual(candidates[0].range.location, 2)
        XCTAssertEqual(candidates[0].range.length, 3)
        XCTAssertFalse(candidates[0].allowDegenerate)
    }

    func testNormalizesTopLeftWindowRectsForElectronStringOutput() {
        let rect = CGRect(x: -10, y: 20, width: 300, height: 400)

        XCTAssertEqual(normalizeTopLeftScreenRectForElectron(rect), rect)
        XCTAssertEqual(formatElectronRectString(rect), "-10.0,20.0,300.0,400.0")
        XCTAssertNil(normalizeTopLeftScreenRectForElectron(CGRect(x: 0, y: 0, width: 0, height: 10)))
        XCTAssertNil(normalizeTopLeftScreenRectForElectron(CGRect(x: 0, y: 0, width: 10, height: 0)))
        XCTAssertNil(normalizeTopLeftScreenRectForElectron(CGRect(x: 0, y: 0, width: 1, height: 10)))
        XCTAssertNil(normalizeTopLeftScreenRectForElectron(CGRect(x: 0, y: 0, width: 10, height: 1)))
    }
}
