import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsDown } from 'lucide-react';
import type { KeyId } from './keys.js';
import { KeyCap } from './KeyCap.js';

interface SpecialPadProps {
  onKey: (id: KeyId) => void;
  /** Show an "abc" button below the grid to summon the text surface (Hybrid mode). */
  onAbc?: () => void;
  /** Show a close button to dismiss the whole keyboard surface. */
  onClose?: () => void;
}

const ARROW_ICON = 18;

/**
 * The special-actions surface: a directional cluster plus a fixed 2×4 grid of
 * terminal control keys. Shared by Hybrid (shows `abc` button below) and Dual
 * KEYS (no extra button). The grid is always the same 8 keys so muscle memory
 * is stable across modes.
 */
export function SpecialPad({ onKey, onAbc, onClose }: SpecialPadProps) {
  return (
    <div style={{ padding: 'var(--s-2)', display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
      {/* Directional cluster */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s-2)' }}>
        <KeyCap label="⇧⇥" sub="mode" ariaLabel="Shift Tab" onPress={() => onKey('shifttab')} />
        <KeyCap label={<ChevronUp size={ARROW_ICON} />} ariaLabel="Up" onPress={() => onKey('up')} />
        <span />
        <KeyCap label={<ChevronLeft size={ARROW_ICON} />} ariaLabel="Left" onPress={() => onKey('left')} />
        <KeyCap label={<ChevronDown size={ARROW_ICON} />} ariaLabel="Down" onPress={() => onKey('down')} />
        <KeyCap label={<ChevronRight size={ARROW_ICON} />} ariaLabel="Right" onPress={() => onKey('right')} />
      </div>

      {/* Control grid — fixed 2×4, same keys in every mode */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-2)' }}>
        <KeyCap label="esc" ariaLabel="Escape" onPress={() => onKey('esc')} />
        <KeyCap label="tab" ariaLabel="Tab" onPress={() => onKey('tab')} />
        <KeyCap label="^C" sub="stop" tone="danger" ariaLabel="Ctrl C" onPress={() => onKey('ctrlc')} />
        <KeyCap label="^R" sub="resume" ariaLabel="Ctrl R" onPress={() => onKey('ctrlr')} />

        <KeyCap label="⇧↵" sub="newline" ariaLabel="Insert newline" onPress={() => onKey('newline')} />
        <KeyCap label="⌫" ariaLabel="Backspace" onPress={() => onKey('backspace')} />
        <KeyCap label="↵" sub="enter" tone="accent" ariaLabel="Enter" onPress={() => onKey('enter')} />
        <KeyCap label="⤓" sub="bottom" ariaLabel="Scroll to bottom" onPress={() => onKey('bottom')} />
      </div>

      {/* Bottom row: optional abc (Hybrid) + optional close-keyboard button */}
      {(onAbc || onClose) && (
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
          {onAbc && (
            <KeyCap
              label="⌨ abc"
              sub="type"
              tone="accent"
              ariaLabel="Text keyboard"
              onPress={onAbc}
              grow={1}
            />
          )}
          {onClose && (
            <KeyCap
              label={<ChevronsDown size={ARROW_ICON} />}
              sub="hide"
              ariaLabel="Hide keyboard"
              onPress={onClose}
              grow={onAbc ? 0 : 1}
            />
          )}
        </div>
      )}
    </div>
  );
}
