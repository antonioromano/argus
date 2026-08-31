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
bool g_hasInputTsfn = false;
bool g_hasResizeTsfn = false;

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

  uint32_t id = g_nextId++;
  OverlayController* c = [[OverlayController alloc] initWithWidth:800 height:480];
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

  g_overlays[id] = c;
  return Napi::Number::New(env, id);
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

Napi::Value ClearScrollback(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c clearScrollback];
  return info.Env().Undefined();
}

Napi::Value Search(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // Mirrors SetFrame's validating convention: `term` feeds straight into
  // Utf8Value()/UTF8String below. `.As<T>()` performs no runtime check, and
  // under NAPI_DISABLE_CPP_EXCEPTIONS a wrong-typed arg would leave a pending
  // exception while more N-API calls are made — undefined behaviour. So the
  // term (and the forward flag) must be validated before either is read.
  if (info.Length() < 3 || !info[1].IsString() || !info[2].IsBoolean()) {
    Napi::TypeError::New(env, "search(id, term, forward) requires a string term and a boolean forward")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  OverlayController* c = Lookup(info, nullptr);
  if (!c) return Napi::Boolean::New(env, false);

  std::string term = info[1].As<Napi::String>().Utf8Value();
  bool forward = info[2].As<Napi::Boolean>().Value();
  BOOL found = [c search:[NSString stringWithUTF8String:term.c_str()] forward:forward];
  return Napi::Boolean::New(env, found == YES);
}

Napi::Value ClearSearch(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c clearSearch];
  return info.Env().Undefined();
}

Napi::Value Destroy(const Napi::CallbackInfo& info) {
  uint32_t id = 0;
  OverlayController* c = Lookup(info, &id);
  if (c) {
    // Drop the callbacks first: nothing should reach JS for a dead id.
    [c setOnInput:nil];
    [c setOnResize:nil];
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("create", Napi::Function::New(env, Create));
  exports.Set("setFrame", Napi::Function::New(env, SetFrame));
  exports.Set("reparent", Napi::Function::New(env, Reparent));
  exports.Set("show", Napi::Function::New(env, Show));
  exports.Set("hide", Napi::Function::New(env, Hide));
  exports.Set("destroy", Napi::Function::New(env, Destroy));
  exports.Set("feed", Napi::Function::New(env, Feed));
  exports.Set("clearScrollback", Napi::Function::New(env, ClearScrollback));
  exports.Set("search", Napi::Function::New(env, Search));
  exports.Set("clearSearch", Napi::Function::New(env, ClearSearch));
  exports.Set("onInput", Napi::Function::New(env, OnInput));
  exports.Set("onResize", Napi::Function::New(env, OnResize));
  return exports;
}

}  // namespace

NODE_API_MODULE(argus_native_terminal, Init)
