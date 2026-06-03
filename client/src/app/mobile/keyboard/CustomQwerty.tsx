import { useState } from 'react';
import { ArrowBigUp, Delete, CornerDownLeft } from 'lucide-react';
import { KeyCap } from './KeyCap.js';

interface CustomQwertyProps {
  onChar: (c: string) => void;
  onBackspace: () => void;
  onNewline: () => void;
  onSubmit: () => void;
}

const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOL_ROWS = ['1234567890', '-/:;()$&@"', '.,?!\'+#='];

/** Self-contained on-screen keyboard for Dual mode. Never raises the native
 *  keyboard. Shift is one-shot; `123`/`abc` toggles a numbers+symbols layer. */
export function CustomQwerty({ onChar, onBackspace, onNewline, onSubmit }: CustomQwertyProps) {
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);

  const press = (c: string) => {
    onChar(shift && !symbols ? c.toUpperCase() : c);
    if (shift) setShift(false);
  };

  const rows = symbols ? SYMBOL_ROWS : LETTER_ROWS;

  return (
    <div style={{ padding: 'var(--s-2)', display: 'flex', flexDirection: 'column', gap: 'var(--s-2)', paddingBottom: 'calc(var(--s-2) + env(safe-area-inset-bottom, 0px))' }}>
      {rows.map((row, i) => {
        const chars = row.split('');
        // Last letter/symbol row gets shift (letters only) + backspace shoulders.
        const isLastRow = i === rows.length - 1;
        return (
          <div key={i} style={{ display: 'flex', gap: 'var(--s-1)', justifyContent: 'center' }}>
            {isLastRow && !symbols && (
              <KeyCap label={<ArrowBigUp size={16} fill={shift ? 'currentColor' : 'none'} />} tone={shift ? 'accent' : 'default'} grow={1.5} ariaLabel="Shift" onPress={() => setShift((v) => !v)} />
            )}
            {chars.map((c) => (
              <KeyCap key={c} label={shift && !symbols ? c.toUpperCase() : c} grow={1} onPress={() => press(c)} />
            ))}
            {isLastRow && (
              <KeyCap label={<Delete size={16} />} grow={1.5} ariaLabel="Backspace" onPress={onBackspace} />
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 'var(--s-1)' }}>
        <KeyCap label={symbols ? 'abc' : '123'} grow={1.4} ariaLabel="Toggle symbols" onPress={() => { setSymbols((v) => !v); setShift(false); }} />
        <KeyCap label="space" grow={4} ariaLabel="Space" onPress={() => onChar(' ')} />
        <KeyCap label={<CornerDownLeft size={16} />} grow={1.4} ariaLabel="Insert newline" onPress={onNewline} />
        <KeyCap label="send" tone="accent" grow={1.6} ariaLabel="Send" onPress={onSubmit} />
      </div>
    </div>
  );
}
