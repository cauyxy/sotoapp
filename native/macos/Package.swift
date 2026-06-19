// swift-tools-version: 6.0

import PackageDescription

// Self-contained dynamic library exposing the unified `soto_*` C-ABI via
// @_cdecl (SotoMacShim.swift). No swift-bridge, no bridging header, and no
// `-undefined dynamic_lookup` — koffi loads this dylib and calls the C symbols
// directly (plan §2.3).
let package = Package(
    name: "SotoMacNative",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "SotoMacNative", type: .dynamic, targets: ["SotoMacNative"])
    ],
    targets: [
        .target(
            name: "SotoMacNative",
            path: "Sources/SotoMacNative"
        ),
        .testTarget(
            name: "SotoMacNativeTests",
            dependencies: ["SotoMacNative"],
            path: "Tests/SotoMacNativeTests"
        )
    ]
)
