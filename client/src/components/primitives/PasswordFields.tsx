import { useState } from 'react';
import { Eye, EyeOff, Check, Minus } from 'lucide-react';
import { Field, TextInput } from './Form.js';
import { NGROK_PW_MIN, isNgrokPasswordValid } from './passwordRules.js';

interface PasswordFieldsProps {
  password: string;
  confirmPassword: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  /** Invoked on Enter in the confirm field. */
  onSubmit?: () => void;
  /** Validation/error message shown under the password field. */
  error?: string;
}

/** A toggleable reveal button pinned to the right edge of a TextInput. */
function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      style={{
        position: 'absolute',
        right: 8,
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 2,
        color: 'var(--fg-3)',
        display: 'flex',
      }}
    >
      {shown ? <EyeOff size={14} strokeWidth={1.6} /> : <Eye size={14} strokeWidth={1.6} />}
    </button>
  );
}

/** Live requirement row — turns green once the rule is met. */
function Requirement({ met, label }: { met: boolean; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 6,
        fontSize: 'var(--t-tiny)',
        color: met ? 'var(--ok)' : 'var(--fg-3)',
        transition: 'color var(--dur-fast)',
      }}
    >
      {met ? <Check size={12} strokeWidth={2} /> : <Minus size={12} strokeWidth={1.6} />}
      {label}
    </div>
  );
}

/** Shared ngrok password + confirm fields: reveal toggle, live requirement, and
 *  green-when-valid borders. State is owned by the parent (needed for submit). */
export function PasswordFields({
  password,
  confirmPassword,
  onPassword,
  onConfirm,
  onSubmit,
  error,
}: PasswordFieldsProps) {
  const [shown, setShown] = useState(false);
  const pwValid = isNgrokPasswordValid(password);
  const confirmValid = confirmPassword.length > 0 && confirmPassword === password && pwValid;
  const inputType = shown ? 'text' : 'password';

  return (
    <>
      <Field label="Password" required error={error}>
        <div style={{ position: 'relative' }}>
          <TextInput
            value={password}
            onChange={onPassword}
            type={inputType}
            placeholder="Set password"
            mono
            valid={pwValid}
            style={{ paddingRight: 36 }}
          />
          <RevealButton shown={shown} onToggle={() => setShown((v) => !v)} />
        </div>
        <Requirement met={pwValid} label={`${NGROK_PW_MIN}+ characters`} />
      </Field>
      <Field label="Confirm password" required>
        <div style={{ position: 'relative' }}>
          <TextInput
            value={confirmPassword}
            onChange={onConfirm}
            type={inputType}
            placeholder="Re-enter password"
            mono
            valid={confirmValid}
            style={{ paddingRight: 36 }}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmit?.(); }}
          />
          <RevealButton shown={shown} onToggle={() => setShown((v) => !v)} />
        </div>
      </Field>
    </>
  );
}
