import ApplicationServices
import Dispatch
import Foundation

nonisolated(unsafe) private var gActiveHookTap: CFMachPort?

private final class HookInstallState: @unchecked Sendable {
    private let lock = NSLock()
    private let semaphore = DispatchSemaphore(value: 0)
    private var installed = false

    func finish(_ value: Bool) {
        lock.lock()
        installed = value
        lock.unlock()
        semaphore.signal()
    }

    func wait() -> Bool {
        semaphore.wait()
        lock.lock()
        defer { lock.unlock() }
        return installed
    }
}

public final class HookBridge: @unchecked Sendable {
    private let lock = NSLock()
    private var runLoop: CFRunLoop?
    private var thread: Thread?

    public init() {}

    public func install() -> Bool {
        lock.lock()
        if thread != nil {
            lock.unlock()
            return false
        }

        let state = HookInstallState()
        let worker = Thread { [weak self, state] in
            guard let self else {
                state.finish(false)
                return
            }

            let mask =
                CGEventMask(1 << CGEventType.flagsChanged.rawValue)
                | CGEventMask(1 << CGEventType.keyDown.rawValue)
                | CGEventMask(1 << CGEventType.keyUp.rawValue)
            guard let tap = CGEvent.tapCreate(
                tap: .cghidEventTap,
                place: .headInsertEventTap,
                options: .defaultTap,
                eventsOfInterest: mask,
                callback: hookCallback,
                userInfo: nil
            ) else {
                state.finish(false)
                return
            }

            guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
                CFMachPortInvalidate(tap)
                state.finish(false)
                return
            }

            let currentRunLoop = CFRunLoopGetCurrent()
            CFRunLoopAddSource(currentRunLoop, source, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            gActiveHookTap = tap

            self.lock.lock()
            self.runLoop = currentRunLoop
            self.lock.unlock()

            state.finish(true)
            CFRunLoopRun()

            gActiveHookTap = nil
            CGEvent.tapEnable(tap: tap, enable: false)
            CFRunLoopRemoveSource(currentRunLoop, source, .commonModes)
            CFMachPortInvalidate(tap)

            self.lock.lock()
            self.runLoop = nil
            self.thread = nil
            self.lock.unlock()
        }

        thread = worker
        lock.unlock()
        worker.start()
        return state.wait()
    }

    public func shutdown() -> Bool {
        lock.lock()
        let currentRunLoop = runLoop
        lock.unlock()

        guard let currentRunLoop else {
            return false
        }

        CFRunLoopStop(currentRunLoop)
        return true
    }
}

private func hookCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    switch type {
    case .tapDisabledByTimeout:
        if let tap = gActiveHookTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    case .flagsChanged:
        // macOS modifiers arrive here (not keyDown/Up); the event still carries
        // the keycode of the modifier that toggled — pass it so the facade can
        // resolve which modifier + derive its down/up edge.
        let keyCode = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
        if soto_mac_hook_dispatch_flags(event.flags.rawValue, keyCode) {
            return nil
        }
    case .keyDown, .keyUp:
        let keyCode = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
        let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
        let edgeDown = type == .keyDown
        if soto_mac_hook_dispatch_key(event.flags.rawValue, keyCode, edgeDown, isRepeat) {
            return nil
        }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}
