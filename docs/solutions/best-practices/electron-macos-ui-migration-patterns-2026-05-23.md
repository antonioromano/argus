---
title: macOS Design System UI Migration Patterns for Electron
date: 2026-05-23
category: docs/solutions/best-practices/
module: client
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Migrating browser UI components to macOS native design system in Electron app
  - Adding new form inputs, modals, or dialogs behind isElectron gate
  - Extending MacSheet-based components with new primitives
  - Fixing visual inconsistencies in diff/editor components
tags:
  - electron
  - macos-design-system
  - iselectron
  - mac-input
  - mac-alert-sheet
  - mac-sheet
  - ui-migration
  - classname-forwarding
  - dual-path-ui
---

# macOS Design System UI Migration Patterns for Electron

## Context

Argus (remote-orchestrator) runs in two runtimes: a browser path and an Electron (native macOS) path. The macOS design system lives in `client/src/components/mac/` and exports primitive components (`MacInput`, `MacSelect`, `MacTextarea`) and container components (`MacSheet`, `MacAlertSheet`). All Electron-specific UI is gated behind a runtime constant declared at the top of each component file:

```typescript
const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');
```

During a migration sprint, several non-obvious patterns emerged that cause silent bugs when missed. This doc captures them as a repeatable checklist.

> **Known fragility**: `isElectron` is re-declared inside each component file as a `const` using a `userAgent` string check. If the detection logic ever needs to change (e.g., using a dedicated Electron preload bridge), all call sites must be updated manually. The current pattern is intentional and consistent — do not diverge from it without updating all usages.

## Guidance

### Pattern 1: Forward `className` on primitive wrappers before swapping

Before replacing a raw `<input>` that carries a `className` used elsewhere (keyboard shortcuts, `document.querySelector`, CSS rules), verify the Mac primitive accepts and forwards `className`. If it does not, add the prop first.

`MacInput` receives and forwards `className` to the inner `<input>` element (not the label+input wrapper div) in `client/src/components/mac/primitives/MacInput.tsx`:

```typescript
// In MacInputProps:
className?: string;

// In the component body — className lands on the <input>, not on the outer wrapper:
<input
  id={id}
  type={type}
  value={value}
  onChange={(e) => onChange(e.target.value)}
  className={className}
  // ...remaining props
/>
```

Without this, any code like `document.querySelector('.diff-search-input')` — used for keyboard shortcuts such as `⌘F` — silently breaks after the swap. The class name must survive the component boundary.

> **Scoping note**: `className` lands on the inner `<input>` element only. If you need it for layout (e.g. setting margin or width on the wrapper), use a wrapping `<div style={...}>` around `<MacInput>` instead. `MacInput` also does not support `style` on the wrapper, by design. `MacSelect` has the same limitation — check for a `className` prop before swapping any raw element that carries one.

### Pattern 2: Gate replacements with isElectron, keep the browser path intact

Never remove the raw browser element. Wrap both paths in a ternary. Note the API difference: `MacInput.onChange` receives the string value directly, not a DOM event.

```tsx
const searchInput = isElectron ? (
  <MacInput
    className="diff-search-input"   // preserve for querySelector
    type="search"
    placeholder="Search files and content…"
    value={searchQuery}
    onChange={setSearchQuery}       // receives value: string directly
  />
) : (
  <input
    className="diff-search-input"
    type="text"
    placeholder="Search files and content…"
    value={searchQuery}
    onChange={e => setSearchQuery(e.target.value)}  // browser event
    style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', padding: '3px 8px' }}
  />
);
```

### Pattern 3: Replace raw div modals with MacAlertSheet — prop-driven open state

`MacAlertSheet` uses an `isOpen` prop rather than conditional rendering. It auto-handles Escape key dismissal and auto-focuses the confirm button. The Electron gate passes `isOpen` from the existing state variable — do not add `showModal &&` before the Mac component (redundant; `MacAlertSheet` manages its own rendering based on `isOpen`):

```tsx
{isElectron ? (
  <MacAlertSheet
    isOpen={showUnsavedModal}
    title="Unsaved changes"
    message="You have unsaved changes. Discard them?"
    confirmLabel="Discard"
    confirmDestructive
    onConfirm={() => {
      setShowUnsavedModal(false);
      pendingNavRef.current?.();
      pendingNavRef.current = null;
    }}
    onCancel={() => setShowUnsavedModal(false)}
  />
) : showUnsavedModal && (           // browser: short-circuit &&
  <div /* raw browser modal */> ... </div>
)}
```

Differences from the browser path:
- The Electron branch renders `<MacAlertSheet isOpen={false}>` when closed (renders nothing internally). Adding `showModal && <MacAlertSheet>` is redundant but harmless.
- Escape key and confirm-button auto-focus are handled by `MacAlertSheet` — no manual Escape handler needed.

### Pattern 4: Extend MacAlertSheet with `altAction` for 3-button alerts

macOS HIG permits three-button alerts. When a modal needs a middle action (e.g. "Reload file" between "Cancel" and "Overwrite"), add the `altAction` prop:

```typescript
// MacAlertSheetProps:
altAction?: { label: string; onClick: () => void };

// In the render, between Cancel and Confirm buttons:
{altAction && (
  <button onClick={() => { altAction.onClick(); onCancel(); }}>
    {altAction.label}
  </button>
)}
```

Usage for a file-conflict scenario:
```tsx
<MacAlertSheet
  isOpen={showConflictModal}
  title="File modified externally"
  message="This file was changed since you started editing. What would you like to do?"
  confirmLabel="Overwrite"
  confirmDestructive
  altAction={{
    label: 'Reload file',
    onClick: () => { if (selectedFilePath) doFileSelect(selectedFilePath, ''); },
  }}
  onConfirm={() => { setShowConflictModal(false); handleSave(true); }}
  onCancel={() => setShowConflictModal(false)}
/>
```

Note: The `MacAlertSheet` implementation calls `altAction.onClick()` followed by `onCancel()` internally, so the sheet **does** auto-close after the alt action. Do not call `setShowConflictModal(false)` inside `altAction.onClick` or `onCancel` will be triggered twice, toggling state unexpectedly.

### Pattern 5: New Mac sheet components use direct-value callbacks, not state reads

When building a new feature sheet, use `MacSheet` as the container and `MacInput` / `MacSelect` as primitives. Pass values as parameters directly to handlers — never read state variables that were just set, because React batches state updates.

```tsx
// BAD — state update is batched; newBranchName still holds the old value when the await runs:
const handleCreate = async () => {
  setNewBranchName(name);
  await onCreateBranch(newBranchName); // reads pre-update value
};

// GOOD — capture the value in a local const before any async call:
const handleCreate = async () => {
  const name = newBranchName.trim();  // read current state once
  if (!name) return;
  await onCreateBranch(name);          // pass directly
  setNewBranchName('');
  onClose();
};
```

When the sheet's callbacks are wired from a parent component that has its own state variables (e.g. `GitDiffPanel`), create dedicated direct-param functions. Always use `finally` to reset loading state — without it, a thrown error leaves the loading flag stuck:

```typescript
// In GitDiffPanel.tsx — dedicated direct-param functions for sheet callbacks:
async function createBranchDirect(name: string) {
  setBranchLoading(true);
  setBranchError('');
  try {
    const result = await api.gitCreateBranch(currentSessionId, name);
    if (result.success) {
      await loadBranches();
      onRefresh();
    } else {
      const msg = result.error ?? 'Create branch failed';
      setBranchError(msg);
      throw new Error(msg);
    }
  } finally {
    setBranchLoading(false); // always clears, even on throw
  }
}
```

### Pattern 6: Diff visual polish — CSS tokens and Lucide chevrons

Replace hardcoded `rgba` diff colors with tokens from `tokens.css`:
```tsx
// Before:
background: theme === 'dark' ? 'rgba(165,213,112,0.10)' : 'rgba(165,213,112,0.12)'

// After:
background: 'var(--color-diff-add-bg)'
```

Replace ASCII chevrons (`▸`/`▾`) with a CSS-rotated `<ChevronRight>` for smooth animation and crisp rendering at all sizes. Only `transition` and `transform` are load-bearing for the animation — the layout properties (`display`, `alignItems`, `width`, `color`) are context-specific:

```tsx
<span style={{
  display: 'inline-flex',  // context-specific; adjust to fit your layout
  transition: 'transform 0.14s ease',
  transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
}}>
  <ChevronRight size={12} strokeWidth={2} />
</span>
```

Stats pills (additions/deletions) use diff tokens for semantic color-coding that responds to theme changes automatically:
```tsx
<span style={{
  background: 'var(--color-diff-add-gutter)',
  color: 'var(--color-diff-add-text)',
  borderRadius: 4,
  padding: '0 5px',
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--font-mono)',
}}>+{file.additions}</span>
```

## Why This Matters

**`className` forwarding is a silent failure.** The UI renders correctly; only runtime behavior (keyboard shortcuts, DOM queries) breaks. The failure is invisible until a user reports that `⌘F` does nothing.

**`MacAlertSheet` is prop-driven, not conditionally rendered.** Pass `isOpen={showModal}` directly — adding `showModal && <MacAlertSheet>` is redundant (the component renders nothing when `isOpen=false`). The real benefit is built-in Escape handling and auto-focus: the raw browser modal needs explicit Escape key listeners and no focus management; `MacAlertSheet` provides both automatically.

**State batching in event handlers.** React 18 batches all state updates. A handler that calls `setState(value)` and then reads that state variable reads the pre-update value. Capturing the value in a local `const` before any async call is the only safe pattern.

**CSS tokens vs hardcoded `rgba`.** Tokens from `tokens.css` / `tokens-electron.css` automatically adapt when the design system updates. Hardcoded values require manual find-and-replace and frequently drift out of sync between light and dark modes.

## When to Apply

Apply these patterns when:

1. Replacing any raw `<input>`, `<select>`, or `<textarea>` with a Mac primitive in a component that already has `isElectron` gating.
2. Migrating raw div-based modals to `MacAlertSheet` — especially when the modal has 2 or 3 buttons.
3. Building a new sheet-based UI (forms, settings panels, branch operations) in the Electron path.
4. Any component that renders `rgba` diff colors inline or uses ASCII collapse indicators (`▸`/`▾`).
5. Any Mac primitive that will be targeted by `document.querySelector` or external CSS — verify `className` forwarding first.

Do not apply the Electron gate when building features that target both runtimes identically, or when the browser and Electron paths are already visually aligned.

## Examples

### MacInput className forwarding (before/after)

**Before** — `className` was not in `MacInputProps`; silently dropped:
```tsx
// document.querySelector('.diff-search-input') returned null after swap
<MacInput value={searchQuery} onChange={setSearchQuery} />
```

**After** — `className` forwarded through to the inner `<input>`:
```tsx
<MacInput
  className="diff-search-input"
  type="search"
  value={searchQuery}
  onChange={setSearchQuery}
/>
// document.querySelector('.diff-search-input') works correctly
```

### Unsaved-changes modal (before/after)

**Before** — custom div modal, no Escape handling, duplicated styling:
```tsx
{showUnsavedModal && (
  <div onClick={() => setShowUnsavedModal(false)} style={{ position: 'fixed', inset: 0, backdropFilter: 'blur(4px)' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-bg-header)', padding: '24px' }}>
      <div style={{ fontWeight: 600 }}>Unsaved changes</div>
      <div>You have unsaved changes. Discard them?</div>
      <button onClick={() => setShowUnsavedModal(false)}>Keep editing</button>
      <button onClick={() => { setShowUnsavedModal(false); pendingNavRef.current?.(); }}>Discard</button>
    </div>
  </div>
)}
```

**After** — Mac native alert in Electron, browser modal unchanged:
```tsx
{isElectron ? (
  <MacAlertSheet
    isOpen={showUnsavedModal}
    title="Unsaved changes"
    message="You have unsaved changes. Discard them?"
    confirmLabel="Discard"
    confirmDestructive
    onConfirm={() => { setShowUnsavedModal(false); pendingNavRef.current?.(); pendingNavRef.current = null; }}
    onCancel={() => setShowUnsavedModal(false)}
  />
) : showUnsavedModal && (
  <div /* browser modal unchanged */> ... </div>
)}
```

### Chevron expand indicator (before/after)

**Before** — ASCII characters, no animation:
```tsx
<span>{expanded ? '▾' : '▸'}</span>
```

**After** — Lucide icon with CSS rotation transition:
```tsx
<span style={{
  display: 'inline-flex',
  transition: 'transform 0.14s ease',
  transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
}}>
  <ChevronRight size={12} strokeWidth={2} />
</span>
```

## Related

- `client/src/components/mac/primitives/MacInput.tsx` — className prop forwarding
- `client/src/components/mac/MacAlertSheet.tsx` — altAction 3-button extension
- `client/src/components/mac/MacSheet.tsx` — base sheet container pattern
- `client/src/components/mac/MacDiffBranchSheet.tsx` — new sheet component example
- `docs/plans/2026-05-23-006-refactor-macos-ui-remaining-gaps-plan.md` — full migration plan
