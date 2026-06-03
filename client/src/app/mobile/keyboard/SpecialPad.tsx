import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { KeyId } from './keys.js';
import { KeyCap } from './KeyCap.js';

interface SpecialPadProps {
  onKey: (id: KeyId) => void;
  /** Show a submit key (text views only). */
  onSubmit?: () => void;
  /** Show an "abc" key that summons the text surface (Hybrid mode). */
  onAbc?: () => void;
}

const ARROW_ICON = 18;

/**
 * The special-actions surface: a directional cluster plus a grid of terminal
 * control keys. Shared by Hybrid (default surface, shows `abc`) and Dual KEYS
 * (no submit; the KEYS↔TEXT toggle handles text). Submit only appears in text
 * views, gated by `onSubmit`.
 */
export function SpecialPad({ onKey, onSubmit, onAbc }: SpecialPadProps) {
  return (
    <div style={{ padding: 'var(--s-2)', display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
      {/* Directional cluster */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s-2)' }}>
        <span />
        <KeyCap label={<ChevronUp size={ARROW_ICON} />} ariaLabel="Up" onPress={() => onKey('up')} />
        <span />
        <KeyCap label={<ChevronLeft size={ARROW_ICON} />} ariaLabel="Left" onPress={() => onKey('left')} />
        <KeyCap label={<ChevronDown size={ARROW_ICON} />} ariaLabel="Down" onPress={() => onKey('down')} />
        <KeyCap label={<ChevronRight size={ARROW_ICON} />} ariaLabel="Right" onPress={() => onKey('right')} />
      </div>

      {/* Control grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-2)' }}>
        <KeyCap label="esc" ariaLabel="Escape" onPress={() => onKey('esc')} />
        <KeyCap label="tab" ariaLabel="Tab" onPress={() => onKey('tab')} />
        <KeyCap label="^C" sub="stop" tone="danger" ariaLabel="Ctrl C" onPress={() => onKey('ctrlc')} />
        <KeyCap label="^R" sub="resume" ariaLabel="Ctrl R" onPress={() => onKey('ctrlr')} />

        <KeyCap label="⇧↵" sub="newline" ariaLabel="Insert newline" onPress={() => onKey('newline')} />
        <KeyCap label="⌫" ariaLabel="Backspace" onPress={() => onKey('backspace')} />
        <KeyCap label="⤒" sub="top" ariaLabel="Scroll to top" onPress={() => onKey('top')} />
        {onSubmit ? (
          <KeyCap label="↵" sub="submit" tone="accent" ariaLabel="Submit" onPress={onSubmit} />
        ) : onAbc ? (
          <KeyCap label="abc" sub="type" tone="accent" ariaLabel="Text keyboard" onPress={onAbc} />
        ) : (
          <KeyCap label="⤓" sub="bottom" ariaLabel="Scroll to bottom" onPress={() => onKey('bottom')} />
        )}
      </div>
    </div>
  );
}
