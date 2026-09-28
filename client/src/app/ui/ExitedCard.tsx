import { Power, RotateCcw } from 'lucide-react';
import type { RunMode } from '@argus/shared';
import { Button } from '../../components/primitives/index.js';

/**
 * Laid over an exited session's terminal so the empty screen explains itself
 * and Restart is one click away instead of buried in the ⋯ menu. The parent
 * must be `position: relative`.
 *
 * Not used over an Advanced (native-view) tile: that terminal is a separate
 * macOS window stacked above the page, so anything drawn here would sit
 * underneath it.
 */
export function ExitedCard({
  runMode,
  folderPath,
  onRestart,
  onClone,
}: {
  runMode?: RunMode;
  folderPath: string;
  onRestart: () => void;
  onClone?: () => void;
}) {
  const stoppedWithArgus = runMode === 'direct';
  return (
    <div
      data-testid="exited-card"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in srgb, var(--bg-0) 60%, transparent)',
      }}
    >
      <div
        role="status"
        style={{
          width: 'min(78%, 340px)',
          padding: '20px 22px',
          textAlign: 'center',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-3)',
          boxShadow: '0 6px 24px rgba(0,0,0,.08)',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            margin: '0 auto 10px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
          }}
        >
          <Power size={16} strokeWidth={2} />
        </div>
        <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: 'var(--fg-0)' }}>
          {stoppedWithArgus ? 'Session stopped' : 'Agent exited'}
        </div>
        <div style={{ marginTop: 4, fontSize: 'var(--t-xs)', lineHeight: 1.45, color: 'var(--fg-2)' }}>
          {stoppedWithArgus ? 'The agent isn’t running. Native sessions stop when Argus quits.' : 'The agent process has ended.'}
          <br />
          Restart starts a fresh agent in <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{folderPath}</span>.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
          <Button variant="primary" size="sm" icon={RotateCcw} onClick={onRestart}>Restart</Button>
          {onClone && <Button variant="outline" size="sm" onClick={onClone}>Clone…</Button>}
        </div>
      </div>
    </div>
  );
}
