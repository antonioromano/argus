import { Keyboard, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { KeyId } from './keys.js';
import { KeyCap } from './KeyCap.js';

interface SpecialToolbarProps {
  onKey: (id: KeyId) => void;
  /** Return to the special-actions pad (Hybrid native view). */
  onBackToKeys: () => void;
}

/**
 * Horizontal strip of terminal keys shown above the native keyboard in Hybrid's
 * text view. Leads with a "keys" button to return to the special-actions pad.
 */
export function SpecialToolbar({ onKey, onBackToKeys }: SpecialToolbarProps) {
  return (
    <div
      className="mobile-keys-toolbar"
      style={{
        display: 'flex',
        gap: 'var(--s-2)',
        padding: 'var(--s-2) var(--s-2)',
        overflowX: 'auto',
        borderBottom: '1px solid var(--line-1)',
        WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
      }}
    >
      <KeyCap label={<Keyboard size={16} />} tone="accent" ariaLabel="Back to keys" onPress={onBackToKeys} />
      <KeyCap label="tab" ariaLabel="Tab" onPress={() => onKey('tab')} />
      <KeyCap label="esc" ariaLabel="Escape" onPress={() => onKey('esc')} />
      <KeyCap label="^C" tone="danger" ariaLabel="Ctrl C" onPress={() => onKey('ctrlc')} />
      <KeyCap label={<ChevronUp size={16} />} ariaLabel="Up" onPress={() => onKey('up')} />
      <KeyCap label={<ChevronDown size={16} />} ariaLabel="Down" onPress={() => onKey('down')} />
      <KeyCap label={<ChevronLeft size={16} />} ariaLabel="Left" onPress={() => onKey('left')} />
      <KeyCap label={<ChevronRight size={16} />} ariaLabel="Right" onPress={() => onKey('right')} />
      <KeyCap label="^R" ariaLabel="Ctrl R" onPress={() => onKey('ctrlr')} />
      <KeyCap label="↵" tone="accent" ariaLabel="Enter" onPress={() => onKey('enter')} />
      <KeyCap label="⤒" ariaLabel="Scroll to top" onPress={() => onKey('top')} />
      <KeyCap label="⤓" ariaLabel="Scroll to bottom" onPress={() => onKey('bottom')} />
    </div>
  );
}
