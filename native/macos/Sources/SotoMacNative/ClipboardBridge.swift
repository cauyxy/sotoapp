import AppKit

protocol ClipboardPasteboard: AnyObject {
    var types: [NSPasteboard.PasteboardType]? { get }
    var changeCount: Int { get }

    func string(forType type: NSPasteboard.PasteboardType) -> String?
    func data(forType type: NSPasteboard.PasteboardType) -> Data?
    func clearContents()
    func setString(_ string: String, forType type: NSPasteboard.PasteboardType) -> Bool
    func setData(_ data: Data, forType type: NSPasteboard.PasteboardType) -> Bool
}

private final class GeneralClipboardPasteboard: ClipboardPasteboard {
    var types: [NSPasteboard.PasteboardType]? {
        NSPasteboard.general.types
    }

    var changeCount: Int {
        NSPasteboard.general.changeCount
    }

    func string(forType type: NSPasteboard.PasteboardType) -> String? {
        NSPasteboard.general.string(forType: type)
    }

    func data(forType type: NSPasteboard.PasteboardType) -> Data? {
        NSPasteboard.general.data(forType: type)
    }

    func clearContents() {
        NSPasteboard.general.clearContents()
    }

    func setString(_ string: String, forType type: NSPasteboard.PasteboardType) -> Bool {
        NSPasteboard.general.setString(string, forType: type)
    }

    func setData(_ data: Data, forType type: NSPasteboard.PasteboardType) -> Bool {
        NSPasteboard.general.setData(data, forType: type)
    }
}

public class ClipboardBridge {
    private enum ClipboardSnapshot {
        case empty
        case items([(NSPasteboard.PasteboardType, Data)])
    }

    private static let maxSnapshotBytes = 50 * 1024 * 1024

    private let pasteboard: ClipboardPasteboard
    private let snapshotLock = NSLock()
    private var pendingSnapshot: ClipboardSnapshot?
    private var pendingChangeCount: Int?

    public convenience init() {
        self.init(pasteboard: GeneralClipboardPasteboard())
    }

    init(pasteboard: ClipboardPasteboard) {
        self.pasteboard = pasteboard
    }

    public func read_text() -> String {
        pasteboard.string(forType: .string) ?? ""
    }

    public func write_text(text: String) -> Bool {
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string)
    }

    public func snapshot_kind() -> Int32 {
        let types = pasteboard.types ?? []
        let transient = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
        let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
        let meaningfulTypes = types.filter { type in
            type != transient && type != concealed
        }
        if meaningfulTypes.isEmpty {
            return 0
        }
        let legacyString = NSPasteboard.PasteboardType("NSStringPboardType")
        if meaningfulTypes.allSatisfy({ $0 == .string || $0 == legacyString }) {
            return 1
        }
        return 2
    }

    public func write_transient(text: String) -> Bool {
        pasteboard.clearContents()
        let wroteText = pasteboard.setString(text, forType: .string)
        let transient = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
        let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
        let wroteMarkers =
            pasteboard.setData(Data(), forType: transient)
            && pasteboard.setData(Data(), forType: concealed)
        return wroteText && wroteMarkers
    }

    public func change_count() -> Int64 {
        Int64(pasteboard.changeCount)
    }

    public func prepare_paste_text(utf8: UnsafePointer<UInt8>?, len: Int) -> Int32 {
        guard let text = decodeUTF8(utf8: utf8, len: len) else {
            return -1
        }

        snapshotLock.lock()
        defer { snapshotLock.unlock() }

        guard pendingSnapshot == nil else {
            return -20
        }

        guard let snapshot = captureSnapshot() else {
            return -21
        }

        pendingSnapshot = snapshot
        guard write_transient(text: text) else {
            let restored = restore(snapshot: snapshot)
            pendingSnapshot = nil
            pendingChangeCount = nil
            return restored ? -1 : -21
        }
        pendingChangeCount = pasteboard.changeCount
        return 0
    }

    private func captureSnapshot() -> ClipboardSnapshot? {
        let types = pasteboard.types ?? []
        if types.isEmpty {
            return .empty
        }

        var captured: [(NSPasteboard.PasteboardType, Data)] = []
        var total = 0
        for type in types {
            guard let data = pasteboard.data(forType: type) else {
                continue
            }
            total += data.count
            if total > Self.maxSnapshotBytes {
                return nil
            }
            captured.append((type, data))
        }

        if captured.isEmpty {
            return nil
        }
        return .items(captured)
    }

    public func restore_after_paste() -> Int32 {
        snapshotLock.lock()
        defer { snapshotLock.unlock() }

        guard let snapshot = pendingSnapshot else {
            return -21
        }

        let expectedChangeCount = pendingChangeCount
        pendingSnapshot = nil
        pendingChangeCount = nil

        if let expectedChangeCount, pasteboard.changeCount != expectedChangeCount {
            // The clipboard was replaced during the paste window; leave the newer content in place.
            return 0
        }

        return restore(snapshot: snapshot) ? 0 : -21
    }

    public func copy_user_text(utf8: UnsafePointer<UInt8>?, len: Int) -> Int32 {
        guard let text = decodeUTF8(utf8: utf8, len: len) else {
            return -1
        }

        snapshotLock.lock()
        defer { snapshotLock.unlock() }
        return write_text(text: text) ? 0 : -1
    }

    private func decodeUTF8(utf8: UnsafePointer<UInt8>?, len: Int) -> String? {
        guard len >= 0 else {
            return nil
        }
        guard len > 0 else {
            return ""
        }
        guard let utf8 else {
            return nil
        }

        return String(decoding: UnsafeBufferPointer(start: utf8, count: len), as: UTF8.self)
    }

    private func restore(snapshot: ClipboardSnapshot) -> Bool {
        switch snapshot {
        case .empty:
            pasteboard.clearContents()
            return true
        case .items(let items):
            pasteboard.clearContents()
            var ok = true
            for (type, data) in items {
                let wrote = type == .string
                    ? pasteboard.setString(String(decoding: data, as: UTF8.self), forType: .string)
                    : pasteboard.setData(data, forType: type)
                if !wrote {
                    ok = false
                }
            }
            return ok
        }
    }
}
