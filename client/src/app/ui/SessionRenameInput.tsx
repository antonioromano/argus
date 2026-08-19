import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SESSION_NAME_MAX } from '@argus/shared';

/**
 * Inline shell-name editor. Sits in place of the name label on whichever surface
 * the rename was started from. Enter commits, Escape and blur cancel — the same
 * contract as the group-rename input in the sidebar tree.
 */
export function SessionRenameInput({
  initial,
  onCommit,
  onCancel,
  style,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  style?: CSSProperties;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // Select the whole name on mount so typing replaces it outright.
  useEffect(() => { ref.current?.select(); }, []);

  return (
    <input
      ref={ref}
      autoFocus
      value={val}
      maxLength={SESSION_NAME_MAX}
      aria-label="Shell name"
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}   // don't start a tile/row drag
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={onCancel}
      onKeyDown={(e) => {
        e.stopPropagation();                     // keep keys out of the terminal
        if (e.key === 'Enter') onCommit(val);
        if (e.key === 'Escape') onCancel();
      }}
      style={{
        flex: 1, minWidth: 0, boxSizing: 'border-box',
        background: 'var(--bg-2)', border: '1px solid var(--accent)', borderRadius: 'var(--r-2)',
        color: 'var(--fg-0)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)',
        padding: '2px 6px', outline: 'none',
        ...style,
      }}
    />
  );
}
