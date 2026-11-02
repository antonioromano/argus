---
title: Native vibrancy invisible behind a fully transparent DOM
date: 2026-10-29
category: docs/solutions/macos/
module: electron
problem_type: configuration_bug
component: electron/src/main.ts command-line switches
severity: medium
applies_when:
  - Translucent sidebar/toolbar looks solid even though vibrancy is set
  - Changing hardware-acceleration or GPU command-line switches in Electron main
  - Revisiting the cold-GPU glyph garble fix (commit 11fb141)
tags: [vibrancy, gpu, hardware-acceleration, transparency, rasterization]
---

# Native vibrancy invisible behind a fully transparent DOM

## Symptom
`BrowserWindow` had `vibrancy: 'sidebar'` and `backgroundColor: '#00000000'`,
`<html data-material="translucent">` was set, and every element from the sidebar
up to `<html>` computed to a transparent (or 60%-alpha) background — verified
live over CDP. Yet the sidebar and toolbar looked solid: dragging the window
over a colourful wallpaper shifted nothing.

## Root cause
`app.disableHardwareAcceleration()` (added in `11fb141` to stop cold-GPU glyph
garble) turns off GPU **compositing** too. Without GPU compositing Chromium
paints the window as an opaque surface, so the NSVisualEffectView behind it is
never seen, no matter how transparent the DOM is.

Confirmed by relaunching the dev app with the call skipped: the vibrancy showed
immediately.

## What was tried, and the decision
Keeping GPU compositing but moving raster to the CPU
(`--disable-gpu-rasterization` + `--disable-accelerated-2d-canvas`) made the
vibrancy visible — but on the very first launch with the GPU back on (cold
shader cache) Claude's input box lost its box-drawing rules and its prompt line
collapsed in every session. A window resize did not fix it; only Cmd+R did —
exactly the original cold-GPU garble. So the garble is not limited to GPU
rasterization; GPU compositing alone is enough to bring it back.

**Decision (2026-10-29):** keep `app.disableHardwareAcceleration()`. The window
material is forced solid in `electron/src/appearanceHost.ts`
(`materialSetting: 'solid'`), the user-facing Window (Translucent/Solid)
setting was removed, and the 12px floating-surface blur never applies (it is
scoped to `data-material="translucent"`). The rest of the macOS polish (system
accent, Increase Contrast, inactive-window look, traffic-light metrics, menu
copy, density) does not need the GPU and stays.

## If translucency is ever revisited
It needs GPU compositing, so it needs a fix for the cold-GPU garble first.
Reproduce: enable the GPU, clear
`~/Library/Application Support/<profile>/{GPUCache,DawnGraphiteCache,DawnWebGPUCache}`,
launch with Claude sessions open, look at the input box. It reproduced in
`npm run dev` too (profile `argus-dev`), not only in the packaged app.

## Don't
- Don't remove `app.disableHardwareAcceleration()` to get vibrancy back — the
  garble returns.
- Don't trust DOM computed styles alone when vibrancy "doesn't show": the
  compositor can be the opaque layer.
