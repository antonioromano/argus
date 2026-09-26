{
  "targets": [{
    "target_name": "argus_native_terminal",
    "sources": ["src/addon.mm"],
    # SwiftPM's mutable `.build/release` symlink always points at whichever
    # arch was most recently built with a plain `swift build -c release`
    # (no --arch). Packaging builds BOTH arches (see scripts/build-native.mjs)
    # and each addon rebuild must link against ITS OWN arch's dylib, not
    # whichever happened to build last — so resolve the concrete per-arch
    # SwiftPM output dir instead of the symlink. target_arch is the gyp
    # variable node-gyp sets from --arch (defaulting to the host arch), so this
    # still resolves correctly for a plain single-arch dev build.
    "conditions": [
      ["target_arch=='arm64'", { "variables": { "swift_arch_dir": "arm64-apple-macosx" } }],
      ["target_arch=='x64'", { "variables": { "swift_arch_dir": "x86_64-apple-macosx" } }]
    ],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      # SwiftPM writes the generated ObjC header into the target's build
      # directory under include/ — NOT into a .framework. Only exists after
      # `swift build -c release --arch <arch>` for the matching arch.
      "../ArgusTerminal/.build/<(swift_arch_dir)/release/ArgusTerminal.build/include"
    ],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "xcode_settings": {
      "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
      "CLANG_ENABLE_OBJC_ARC": "YES",
      "GCC_ENABLE_CPP_EXCEPTIONS": "NO",
      "MACOSX_DEPLOYMENT_TARGET": "13.0",
      # A SwiftPM `.dynamic` product is libArgusTerminal.dylib — a plain dylib,
      # not a .framework. Link it with -L/-l and give the loader two rpaths:
      #   1. the dev tree, where the dylib lives under
      #      native/ArgusTerminal/.build/<arch>/release/ (relative to the .node
      #      at native/addon/build/Release/);
      #   2. the packaged app, where electron-builder's native-terminal
      #      extraResources entry places the matching arch's dylib right next
      #      to this .node file (see electron-builder.config.cjs and
      #      scripts/build-native.mjs) — so a bare @loader_path finds it.
      # The dynamic linker tries rpath entries in order and uses the first one
      # that resolves, so the same binary works in both layouts.
      # -L is resolved against the *build* cwd (native/addon/build), not against
      # this file, so it must be absolute: <(module_root_dir) is native/addon.
      "OTHER_LDFLAGS": [
        "-L<(module_root_dir)/../ArgusTerminal/.build/<(swift_arch_dir)/release",
        "-lArgusTerminal",
        "-Wl,-rpath,@loader_path/../../../ArgusTerminal/.build/<(swift_arch_dir)/release",
        "-Wl,-rpath,@loader_path"
      ]
    },
    "link_settings": {
      "libraries": [
        "$(SDKROOT)/System/Library/Frameworks/Cocoa.framework"
      ]
    }
  }]
}
