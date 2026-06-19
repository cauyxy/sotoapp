import AppKit
import XCTest
@testable import SotoMacNative

final class ClipboardBridgeTests: XCTestCase {
    private let bridge = ClipboardBridge()
    private let pasteboard = NSPasteboard.general

    override func tearDown() {
        pasteboard.clearContents()
        super.tearDown()
    }

    func testClassifiesEmptyPasteboardAsEmpty() {
        pasteboard.clearContents()

        XCTAssertEqual(bridge.snapshot_kind(), 0)
    }

    func testClassifiesPlainStringPasteboardAsText() {
        pasteboard.clearContents()
        pasteboard.setString("hello", forType: .string)

        XCTAssertEqual(bridge.snapshot_kind(), 1)
    }

    func testClassifiesStringWithTransientMarkersAsText() {
        pasteboard.clearContents()
        pasteboard.setString("hello", forType: .string)
        pasteboard.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
        pasteboard.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))

        XCTAssertEqual(bridge.snapshot_kind(), 1)
    }

    func testClassifiesStringWithRichOrCustomTypesAsRich() {
        pasteboard.clearContents()
        pasteboard.setString("hello", forType: .string)
        pasteboard.setData(Data("rich".utf8), forType: .rtf)

        XCTAssertEqual(bridge.snapshot_kind(), 2)

        pasteboard.clearContents()
        pasteboard.setString("hello", forType: .string)
        pasteboard.setData(Data("custom".utf8), forType: NSPasteboard.PasteboardType("com.example.custom"))

        XCTAssertEqual(bridge.snapshot_kind(), 2)
    }

    func testPrepareRestoresCapturedTextWhenTransientWriteFails() {
        let fakePasteboard = FakeClipboardPasteboard()
        fakePasteboard.storedString = "original"
        fakePasteboard.failDataWrites = true
        let bridge = ClipboardBridge(pasteboard: fakePasteboard)

        XCTAssertEqual(withUTF8("payload") { bridge.prepare_paste_text(utf8: $0, len: $1) }, -1)
        XCTAssertEqual(fakePasteboard.storedString, "original")

        fakePasteboard.failDataWrites = false
        XCTAssertEqual(withUTF8("payload") { bridge.prepare_paste_text(utf8: $0, len: $1) }, 0)
    }

    func testRestoreFailureReturnsUnrestorableAndClearsPendingSnapshot() {
        let fakePasteboard = FakeClipboardPasteboard()
        fakePasteboard.storedString = "original"
        let bridge = ClipboardBridge(pasteboard: fakePasteboard)

        XCTAssertEqual(withUTF8("payload") { bridge.prepare_paste_text(utf8: $0, len: $1) }, 0)

        fakePasteboard.failStringWrites = true
        XCTAssertEqual(bridge.restore_after_paste(), -21)

        fakePasteboard.failStringWrites = false
        XCTAssertEqual(withUTF8("payload") { bridge.prepare_paste_text(utf8: $0, len: $1) }, 0)
    }

    func testRestoreSkippedWhenClipboardChangedDuringPaste() {
        let fake = FakeClipboardPasteboard()
        fake.storedString = "original"
        let bridge = ClipboardBridge(pasteboard: fake)

        XCTAssertEqual(withUTF8("dictated") { bridge.prepare_paste_text(utf8: $0, len: $1) }, 0)

        _ = fake.setString("user copied later", forType: .string)

        XCTAssertEqual(bridge.restore_after_paste(), 0)
        XCTAssertEqual(fake.storedString, "user copied later")
    }

    func testCapturesAndRestoresAllRichFlavors() {
        let fake = FakeClipboardPasteboard()
        fake.storedString = "selected text"
        fake.storedData[.rtf] = Data("rtf-bytes".utf8)
        fake.storedData[NSPasteboard.PasteboardType("public.html")] = Data("<b>html</b>".utf8)
        let bridge = ClipboardBridge(pasteboard: fake)

        XCTAssertEqual(withUTF8("dictated") { bridge.prepare_paste_text(utf8: $0, len: $1) }, 0)
        XCTAssertEqual(fake.storedString, "dictated")

        XCTAssertEqual(bridge.restore_after_paste(), 0)
        XCTAssertEqual(fake.storedString, "selected text")
        XCTAssertEqual(fake.storedData[.rtf], Data("rtf-bytes".utf8))
        XCTAssertEqual(
            fake.storedData[NSPasteboard.PasteboardType("public.html")],
            Data("<b>html</b>".utf8)
        )
    }

    func testEmptyClipboardRoundTrips() {
        let fake = FakeClipboardPasteboard()
        let bridge = ClipboardBridge(pasteboard: fake)

        XCTAssertEqual(withUTF8("dictated") { bridge.prepare_paste_text(utf8: $0, len: $1) }, 0)
        XCTAssertEqual(fake.storedString, "dictated")

        XCTAssertEqual(bridge.restore_after_paste(), 0)
        XCTAssertNil(fake.storedString)
    }

    func testNonEmptyButUnreadableClipboardReturnsUnrestorable() {
        let fake = FakeClipboardPasteboard()
        fake.promisedTypes = [NSPasteboard.PasteboardType("com.apple.pasteboard.promised-file-url")]
        let bridge = ClipboardBridge(pasteboard: fake)

        XCTAssertEqual(withUTF8("dictated") { bridge.prepare_paste_text(utf8: $0, len: $1) }, -21)
        XCTAssertNil(fake.storedString) // transient payload was NOT written
    }

    func testOversizedClipboardReturnsUnrestorable() {
        let fake = FakeClipboardPasteboard()
        fake.storedData[NSPasteboard.PasteboardType("public.tiff")] = Data(count: 60 * 1024 * 1024)
        let bridge = ClipboardBridge(pasteboard: fake)

        XCTAssertEqual(withUTF8("dictated") { bridge.prepare_paste_text(utf8: $0, len: $1) }, -21)
        XCTAssertNil(fake.storedString) // transient payload was NOT written
    }

    private func withUTF8(_ value: String, _ body: (UnsafePointer<UInt8>?, Int) -> Int32) -> Int32 {
        Array(value.utf8).withUnsafeBufferPointer { buffer in
            body(buffer.baseAddress, buffer.count)
        }
    }
}

private final class FakeClipboardPasteboard: ClipboardPasteboard {
    var storedString: String?
    var storedData: [NSPasteboard.PasteboardType: Data] = [:]
    /// Types that are present but whose data cannot be read (promised/lazy providers).
    var promisedTypes: [NSPasteboard.PasteboardType] = []
    var failStringWrites = false
    var failDataWrites = false
    var changeCount = 0

    var types: [NSPasteboard.PasteboardType]? {
        var current: [NSPasteboard.PasteboardType] = []
        if storedString != nil {
            current.append(.string)
        }
        current.append(contentsOf: storedData.keys)
        current.append(contentsOf: promisedTypes)
        return current
    }

    func string(forType type: NSPasteboard.PasteboardType) -> String? {
        type == .string ? storedString : nil
    }

    func data(forType type: NSPasteboard.PasteboardType) -> Data? {
        if promisedTypes.contains(type) {
            return nil
        }
        if type == .string {
            return storedString.map { Data($0.utf8) }
        }
        return storedData[type]
    }

    func clearContents() {
        storedString = nil
        storedData.removeAll()
        changeCount += 1
    }

    func setString(_ string: String, forType type: NSPasteboard.PasteboardType) -> Bool {
        guard !failStringWrites, type == .string else {
            return false
        }
        storedString = string
        changeCount += 1
        return true
    }

    func setData(_ data: Data, forType type: NSPasteboard.PasteboardType) -> Bool {
        guard !failDataWrites else {
            return false
        }
        if type == .string {
            storedString = String(decoding: data, as: UTF8.self)
        } else {
            storedData[type] = data
        }
        changeCount += 1
        return true
    }
}
