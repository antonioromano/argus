// N-API bridge between the Electron main process and the Swift
// OverlayController (native/ArgusTerminal). This layer marshals bytes and
// geometry and nothing else — it owns no pty and makes no policy decisions.
// All JS entry points run on the Electron main thread, which is also the
// AppKit main thread, so the AppKit calls below need no dispatch.

#import <Cocoa/Cocoa.h>
#import "ArgusTerminal-Swift.h"  // SwiftPM-generated, see binding.gyp include_dirs
#include <napi.h>
#include <map>
#include <string>
#include <vector>

namespace {

std::map<uint32_t, OverlayController*> g_overlays;
uint32_t g_nextId = 1;

// SwiftTerm fires its delegate callbacks on the main thread, which in Electron
// is the JS thread. A ThreadSafeFunction is still the right vehicle: it keeps
// delivery ordered and stays correct if a callback ever arrives off-thread.
// Both are created unreferenced so the addon never keeps the loop alive.
Napi::ThreadSafeFunction g_inputTsfn;
Napi::ThreadSafeFunction g_resizeTsfn;
Napi::ThreadSafeFunction g_focusTsfn;
Napi::ThreadSafeFunction g_openLinkTsfn;
Napi::ThreadSafeFunction g_dropTsfn;
Napi::ThreadSafeFunction g_bellTsfn;
bool g_hasInputTsfn = false;
bool g_hasResizeTsfn = false;
bool g_hasFocusTsfn = false;
bool g_hasOpenLinkTsfn = false;
bool g_hasDropTsfn = false;
bool g_hasBellTsfn = false;

OverlayController* Lookup(const Napi::CallbackInfo& info, uint32_t* outId) {
  if (info.Length() < 1 || !info[0].IsNumber()) return nil;
  uint32_t id = info[0].As<Napi::Number>().Uint32Value();
  if (outId) *outId = id;
  auto it = g_overlays.find(id);
  return it == g_overlays.end() ? nil : it->second;
}

// Installs `fn` as the sole callback for `slot`, releasing whatever was there.
void InstallTsfn(const Napi::CallbackInfo& info,
                 const char* name,
                 Napi::ThreadSafeFunction* slot,
                 bool* flag) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "expected a callback function").ThrowAsJavaScriptException();
    return;
  }
  if (*flag) {
    slot->Release();
    *flag = false;
  }
  *slot = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), name, 0, 1);
  slot->Unref(env);
  *flag = true;
}

// BrowserWindow.getNativeWindowHandle() yields an NSView*, NOT an NSWindow*.
Napi::Value Create(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "create(parentHandle: Buffer) requires a Buffer")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto buf = info[0].As<Napi::Buffer<char>>();
  if (buf.Length() < sizeof(void*)) {
    Napi::TypeError::New(env, "parentHandle buffer is too small to hold an NSView*")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  NSView* view = *reinterpret_cast<NSView* __unsafe_unretained*>(buf.Data());
  NSWindow* parent = [view window];
  if (parent == nil) {
    Napi::Error::New(env, "parent NSView has no NSWindow").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Optional second argument: scrollback depth. Validated like setFrame's
  // geometry — an unchecked As<Number>() on a non-number is UB here.
  int scrollback = 0;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    scrollback = info[1].As<Napi::Number>().Int32Value();
  }

  uint32_t id = g_nextId++;
  OverlayController* c = [[OverlayController alloc] initWithWidth:800 height:480];
  if (scrollback > 0) [c setScrollback:scrollback];
  // attach: has no double-call guard on the Swift side — call it exactly once
  // per controller, here, and never again.
  [c attachTo:parent];

  // The blocks capture `id` by value only; capturing `c` would retain-cycle.
  [c setOnInput:^(NSData* data) {
    if (!g_hasInputTsfn) return;
    std::string bytes(static_cast<const char*>(data.bytes), data.length);
    g_inputTsfn.BlockingCall([id, bytes](Napi::Env env, Napi::Function cb) {
      cb.Call({Napi::Number::New(env, id),
               Napi::Buffer<char>::Copy(env, bytes.data(), bytes.size())});
    });
  }];
  [c setOnResize:^(NSInteger cols, NSInteger rows) {
    if (!g_hasResizeTsfn) return;
    g_resizeTsfn.BlockingCall([id, cols, rows](Napi::Env env, Napi::Function cb) {
      cb.Call({Napi::Number::New(env, id),
               Napi::Number::New(env, static_cast<double>(cols)),
               Napi::Number::New(env, static_cast<double>(rows))});
    });
  }];

  [c setOnFocus:^(BOOL focused) {
    if (!g_hasFocusTsfn) return;
    bool isFocused = focused ? true : false;
    g_focusTsfn.BlockingCall([id, isFocused](Napi::Env env, Napi::Function cb) {
      cb.Call({Napi::Number::New(env, id), Napi::Boolean::New(env, isFocused)});
    });
  }];

  [c setOnOpenLink:^(NSString* link) {
    if (!g_hasOpenLinkTsfn) return;
    std::string url(link.UTF8String ? link.UTF8String : "");
    g_openLinkTsfn.BlockingCall([id, url](Napi::Env env, Napi::Function cb) {
      cb.Call({Napi::Number::New(env, id), Napi::String::New(env, url)});
    });
  }];

  [c setOnBell:^{
    if (!g_hasBellTsfn) return;
    g_bellTsfn.BlockingCall([id](Napi::Env env, Napi::Function cb) {
      cb.Call({Napi::Number::New(env, id)});
    });
  }];

  [c setOnDropPaths:^(NSArray* paths) {
    if (!g_hasDropTsfn) return;
    std::vector<std::string> out;
    for (NSString* p in paths) {
      if ([p isKindOfClass:[NSString class]] && p.UTF8String) out.push_back(p.UTF8String);
    }
    g_dropTsfn.BlockingCall([id, out](Napi::Env env, Napi::Function cb) {
      Napi::Array arr = Napi::Array::New(env, out.size());
      for (size_t i = 0; i < out.size(); i++) {
        arr.Set(static_cast<uint32_t>(i), Napi::String::New(env, out[i]));
      }
      cb.Call({Napi::Number::New(env, id), arr});
    });
  }];

  g_overlays[id] = c;
  return Napi::Number::New(env, id);
}

// setDimmed(id, dimmed, isDark) — paints the unfocused-tile scrim the xterm
// path draws with `.argus-tile-overlay`. Validated like the other setters.
Napi::Value SetDimmed(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[1].IsBoolean() || !info[2].IsBoolean()) {
    Napi::TypeError::New(env, "setDimmed(id, dimmed, isDark) requires two booleans")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  OverlayController* c = Lookup(info, nullptr);
  if (c) {
    [c setDimmed:info[1].As<Napi::Boolean>().Value()
          isDark:info[2].As<Napi::Boolean>().Value()];
  }
  return env.Undefined();
}

Napi::Value SetFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // `.As<Napi::Number>()` performs no runtime check. Under
  // NAPI_DISABLE_CPP_EXCEPTIONS, DoubleValue() on a non-number leaves a JS
  // exception *pending* and returns 0 — and every further N-API call made while
  // an exception is pending is undefined behaviour, in practice an abort. So the
  // geometry has to be validated before any of it is read, the way Create does.
  if (info.Length() < 5) {
    Napi::TypeError::New(env, "setFrame(id, x, y, width, height) requires 5 arguments")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  for (size_t i = 1; i <= 4; ++i) {
    if (!info[i].IsNumber()) {
      Napi::TypeError::New(env, "setFrame(id, x, y, width, height) requires numeric x, y, width and height")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
  }

  OverlayController* c = Lookup(info, nullptr);
  if (c) {
    [c setFrameWithX:info[1].As<Napi::Number>().DoubleValue()
                   y:info[2].As<Napi::Number>().DoubleValue()
               width:info[3].As<Napi::Number>().DoubleValue()
              height:info[4].As<Napi::Number>().DoubleValue()];
  }
  return env.Undefined();
}

// setTheme(id, background, foreground, cursor, ansi[]) — background/
// foreground/cursor are "#rrggbb" strings, ansi is the 16 ANSI colors in
// xterm order (see OverlayController.setTheme's doc comment). Validated the
// same way Create/SetFrame are: `.As<T>()` performs no runtime check, so
// every argument's actual JS type is confirmed before any of it is read.
Napi::Value SetTheme(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 5 || !info[0].IsNumber() || !info[1].IsString() ||
      !info[2].IsString() || !info[3].IsString() || !info[4].IsArray()) {
    Napi::TypeError::New(env,
        "setTheme(id, background, foreground, cursor, ansi[]) requires "
        "(number, string, string, string, string[])")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Array ansiArr = info[4].As<Napi::Array>();
  NSMutableArray<NSString*>* ansi = [NSMutableArray arrayWithCapacity:ansiArr.Length()];
  for (uint32_t i = 0; i < ansiArr.Length(); ++i) {
    Napi::Value v = ansiArr.Get(i);
    if (!v.IsString()) {
      Napi::TypeError::New(env, "setTheme ansi[] must contain only strings")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    [ansi addObject:[NSString stringWithUTF8String:v.As<Napi::String>().Utf8Value().c_str()]];
  }

  OverlayController* c = Lookup(info, nullptr);
  if (c) {
    NSString* bg = [NSString stringWithUTF8String:info[1].As<Napi::String>().Utf8Value().c_str()];
    NSString* fg = [NSString stringWithUTF8String:info[2].As<Napi::String>().Utf8Value().c_str()];
    NSString* cursor = [NSString stringWithUTF8String:info[3].As<Napi::String>().Utf8Value().c_str()];
    [c setThemeWithBackgroundHex:bg foregroundHex:fg cursorHex:cursor ansiHex:ansi];
  }
  return env.Undefined();
}

Napi::Value Reparent(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsBuffer()) {
    Napi::TypeError::New(env, "reparent(id, parentHandle) requires a Buffer handle")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto buf = info[1].As<Napi::Buffer<char>>();
  if (buf.Length() < sizeof(void*)) {
    Napi::TypeError::New(env, "reparent(id, parentHandle): handle too small")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  OverlayController* c = Lookup(info, nullptr);
  if (c) {
    NSView* view = *reinterpret_cast<NSView* __unsafe_unretained*>(buf.Data());
    NSWindow* parent = [view window];
    if (parent == nil) {
      Napi::Error::New(env, "parent NSView has no NSWindow").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    [c reparentTo:parent];
  }
  return env.Undefined();
}

Napi::Value Feed(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c && info.Length() >= 2 && info[1].IsBuffer()) {
    auto buf = info[1].As<Napi::Buffer<char>>();
    [c feedWithData:[NSData dataWithBytes:buf.Data() length:buf.Length()]];
  }
  return info.Env().Undefined();
}

Napi::Value Show(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c show];
  return info.Env().Undefined();
}

Napi::Value Hide(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c hide];
  return info.Env().Undefined();
}

Napi::Value FocusOverlay(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c focusTerminal];
  return info.Env().Undefined();
}

Napi::Value ClearScrollback(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c clearScrollback];
  return info.Env().Undefined();
}

// Search is no longer driven with a term from JS (see task-6 report's
// reversal): a DOM search box can never paint above a native tile's child
// NSWindow (Gate A), so the renderer instead toggles SwiftTerm's OWN find
// bar, which lives inside that same window. OpenFindBar/CloseFindBar take no
// arguments beyond the id — everything else (typing, next/prev, options) is
// handled by SwiftTerm's own NSSearchField, never round-tripping through JS.
Napi::Value OpenFindBar(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c openFindBar];
  return info.Env().Undefined();
}

Napi::Value CloseFindBar(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c closeFindBar];
  return info.Env().Undefined();
}

// Synchronous read of the grid the last setFrame produced. onResize carries
// the same numbers, but only after a thread-safe-function hop back to the JS
// loop — too late for the host, which needs them to size the replay seed.
Napi::Value GridSize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  OverlayController* c = Lookup(info, nullptr);
  if (!c) return env.Undefined();
  Napi::Object size = Napi::Object::New(env);
  size.Set("cols", Napi::Number::New(env, static_cast<double>(c.gridCols)));
  size.Set("rows", Napi::Number::New(env, static_cast<double>(c.gridRows)));
  return size;
}

Napi::Value Destroy(const Napi::CallbackInfo& info) {
  uint32_t id = 0;
  OverlayController* c = Lookup(info, &id);
  if (c) {
    // Drop the callbacks first: nothing should reach JS for a dead id. The
    // host reports the lost key focus itself (NativeTerminalHost.detach), so
    // silencing onFocus here cannot strand the renderer's focus state.
    [c setOnInput:nil];
    [c setOnResize:nil];
    [c setOnFocus:nil];
    [c setOnOpenLink:nil];
    [c setOnDropPaths:nil];
    [c setOnBell:nil];
    [c destroy];
    g_overlays.erase(id);
  }
  return info.Env().Undefined();
}

Napi::Value OnInput(const Napi::CallbackInfo& info) {
  InstallTsfn(info, "argusInput", &g_inputTsfn, &g_hasInputTsfn);
  return info.Env().Undefined();
}

Napi::Value OnResize(const Napi::CallbackInfo& info) {
  InstallTsfn(info, "argusResize", &g_resizeTsfn, &g_hasResizeTsfn);
  return info.Env().Undefined();
}
Napi::Value OnFocus(const Napi::CallbackInfo& info) {
  InstallTsfn(info, "argusFocus", &g_focusTsfn, &g_hasFocusTsfn);
  return info.Env().Undefined();
}
Napi::Value OnOpenLink(const Napi::CallbackInfo& info) {
  InstallTsfn(info, "argusOpenLink", &g_openLinkTsfn, &g_hasOpenLinkTsfn);
  return info.Env().Undefined();
}
Napi::Value OnBell(const Napi::CallbackInfo& info) {
  InstallTsfn(info, "argusBell", &g_bellTsfn, &g_hasBellTsfn);
  return info.Env().Undefined();
}
Napi::Value OnDropPaths(const Napi::CallbackInfo& info) {
  InstallTsfn(info, "argusDropPaths", &g_dropTsfn, &g_hasDropTsfn);
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("create", Napi::Function::New(env, Create));
  exports.Set("setFrame", Napi::Function::New(env, SetFrame));
  exports.Set("setTheme", Napi::Function::New(env, SetTheme));
  exports.Set("reparent", Napi::Function::New(env, Reparent));
  exports.Set("show", Napi::Function::New(env, Show));
  exports.Set("hide", Napi::Function::New(env, Hide));
  exports.Set("destroy", Napi::Function::New(env, Destroy));
  exports.Set("feed", Napi::Function::New(env, Feed));
  exports.Set("gridSize", Napi::Function::New(env, GridSize));
  exports.Set("focusOverlay", Napi::Function::New(env, FocusOverlay));
  exports.Set("clearScrollback", Napi::Function::New(env, ClearScrollback));
  exports.Set("openFindBar", Napi::Function::New(env, OpenFindBar));
  exports.Set("closeFindBar", Napi::Function::New(env, CloseFindBar));
  exports.Set("onInput", Napi::Function::New(env, OnInput));
  exports.Set("onResize", Napi::Function::New(env, OnResize));
  exports.Set("setDimmed", Napi::Function::New(env, SetDimmed));
  exports.Set("onFocus", Napi::Function::New(env, OnFocus));
  exports.Set("onOpenLink", Napi::Function::New(env, OnOpenLink));
  exports.Set("onDropPaths", Napi::Function::New(env, OnDropPaths));
  exports.Set("onBell", Napi::Function::New(env, OnBell));
  return exports;
}

}  // namespace

NODE_API_MODULE(argus_native_terminal, Init)
