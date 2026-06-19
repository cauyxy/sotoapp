import XCTest
@testable import SotoMacNative

final class InjectionBridgeTests: XCTestCase {
    func testMapsSyntheticDeliveryPreflightToAttemptCodes() {
        XCTAssertEqual(
            syntheticDeliveryAttemptCode(
                accessibilityTrusted: false,
                secureEventInputEnabled: false,
                focusedElementKnown: false,
                focusedElementIsSecureTextField: false
            ),
            nativeAttemptNotTrusted
        )
        XCTAssertEqual(
            syntheticDeliveryAttemptCode(
                accessibilityTrusted: true,
                secureEventInputEnabled: true,
                focusedElementKnown: false,
                focusedElementIsSecureTextField: false
            ),
            nativeAttemptSecureEventInput
        )
        XCTAssertEqual(
            syntheticDeliveryAttemptCode(
                accessibilityTrusted: true,
                secureEventInputEnabled: false,
                focusedElementKnown: true,
                focusedElementIsSecureTextField: true
            ),
            nativeAttemptSecureTextField
        )
        XCTAssertEqual(
            syntheticDeliveryAttemptCode(
                accessibilityTrusted: true,
                secureEventInputEnabled: false,
                focusedElementKnown: false,
                focusedElementIsSecureTextField: false
            ),
            nativeAttemptOk
        )
    }

    func testAllowsSyntheticDeliveryWhenAXFocusIsMissingButKeyboardDeliveryIsNotProtected() {
        XCTAssertTrue(
            syntheticDeliveryAllowed(
                accessibilityTrusted: true,
                secureEventInputEnabled: false,
                focusedElementKnown: false,
                focusedElementIsSecureTextField: false
            )
        )
    }

    func testBlocksSyntheticDeliveryForSecureOrUntrustedTargets() {
        XCTAssertFalse(
            syntheticDeliveryAllowed(
                accessibilityTrusted: false,
                secureEventInputEnabled: false,
                focusedElementKnown: false,
                focusedElementIsSecureTextField: false
            )
        )
        XCTAssertFalse(
            syntheticDeliveryAllowed(
                accessibilityTrusted: true,
                secureEventInputEnabled: true,
                focusedElementKnown: false,
                focusedElementIsSecureTextField: false
            )
        )
        XCTAssertFalse(
            syntheticDeliveryAllowed(
                accessibilityTrusted: true,
                secureEventInputEnabled: false,
                focusedElementKnown: true,
                focusedElementIsSecureTextField: true
            )
        )
    }
}
