import { useState, useEffect, useRef } from 'react';

interface InlineNameInputProps {
  initialValue?: string;
  siblingNames: string[]; // existing sibling file/folder names for duplicate check
  onConfirm: (name: string) => void;
  onCancel: () => void;
  depth: number; // for indentation matching
  isDir?: boolean;
}

export function InlineNameInput({
  initialValue = '',
  siblingNames,
  onConfirm,
  onCancel,
  depth,
  isDir,
}: InlineNameInputProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Prevents blur from firing cancel after Enter confirms
  const blurIgnoreRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function validate(name: string): string | null {
    if (!name.trim()) return 'Name cannot be empty';
    if (name.includes('/')) return "Name cannot contain '/'";
    if (name.includes('\0')) return 'Invalid character';
    if (new TextEncoder().encode(name).length > 255) return 'Name too long';
    if (
      name !== initialValue &&
      siblingNames.some((s) => s.toLowerCase() === name.toLowerCase())
    ) {
      return `A ${isDir ? 'folder' : 'file'} named '${name}' already exists`;
    }
    return null;
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    setError(validate(e.target.value));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      const err = validate(value);
      if (err) {
        setError(err);
        return;
      }
      // No-op rename: Enter acts as Escape when name hasn't changed
      if (value === initialValue) {
        onCancel();
        return;
      }
      blurIgnoreRef.current = true;
      onConfirm(value);
    }
  };

  const handleBlur = () => {
    if (blurIgnoreRef.current) return;
    onCancel();
  };

  // Indentation: depth * 16 (tree indent) + 8 (row padding) + 14 (icon) + 4 + 4 + 16 = depth*16 + 46
  // Simplified to depth * 16 + 8 + 36 per plan spec
  const paddingLeft = depth * 16 + 8 + 36;

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={{
          width: '100%',
          height: '22px',
          boxSizing: 'border-box',
          paddingLeft: `${paddingLeft}px`,
          paddingRight: '8px',
          background: 'var(--color-input-bg, rgba(255,255,255,0.05))',
          border: `1px solid ${error ? 'var(--color-error, #ef4444)' : 'var(--color-accent, #4a90e2)'}`,
          borderRadius: '3px',
          color: 'inherit',
          fontSize: '12px',
          outline: 'none',
        }}
      />
      {error && (
        <div
          style={{
            position: 'absolute',
            top: '22px',
            left: 0,
            zIndex: 100,
            background: 'var(--color-bg-elevated, #1e1e1e)',
            border: '1px solid var(--color-error, #ef4444)',
            borderRadius: '3px',
            padding: '3px 6px',
            fontSize: '11px',
            color: 'var(--color-error, #ef4444)',
            whiteSpace: 'nowrap',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
