{
  "targets": [{
    "target_name": "argus_native_terminal",
    "sources": ["src/addon.mm"],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      # SwiftPM writes the generated ObjC header into the target's build
      # directory under include/ — NOT into a .framework. `.build/release` is a
      # symlink to `.build/<arch>-apple-macosx/release`, so this stays
      # arch-agnostic. It only exists after `swift build -c release`.
      "../ArgusTerminal/.build/release/ArgusTerminal.build/include"
    ],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "xcode_settings": {
      "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
      "CLANG_ENABLE_OBJC_ARC": "YES",
      "GCC_ENABLE_CPP_EXCEPTIONS": "NO",
      "MACOSX_DEPLOYMENT_TARGET": "13.0",
      # A SwiftPM `.dynamic` product is libArgusTerminal.dylib — a plain dylib,
      # not a .framework. Link it with -L/-l and give the loader an rpath.
      # -L is resolved against the *build* cwd (native/addon/build), not against
      # this file, so it must be absolute: <(module_root_dir) is native/addon.
      # The rpath is relative to the .node at native/addon/build/Release/.
      "OTHER_LDFLAGS": [
        "-L<(module_root_dir)/../ArgusTerminal/.build/release",
        "-lArgusTerminal",
        "-Wl,-rpath,@loader_path/../../../ArgusTerminal/.build/release"
      ]
    },
    "link_settings": {
      "libraries": [
        "$(SDKROOT)/System/Library/Frameworks/Cocoa.framework"
      ]
    }
  }]
}
