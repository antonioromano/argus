// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArgusTerminal",
  platforms: [.macOS(.v13)],
  products: [.library(name: "ArgusTerminal", type: .dynamic, targets: ["ArgusTerminal"])],
  dependencies: [.package(url: "https://github.com/migueldeicaza/SwiftTerm", from: "1.2.0")],
  targets: [
    .target(name: "ArgusTerminal", dependencies: ["SwiftTerm"]),
    .testTarget(name: "ArgusTerminalTests", dependencies: ["ArgusTerminal"]),
  ]
)
