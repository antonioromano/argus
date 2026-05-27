import type { SessionInfo } from '@argus/shared';
import { Button, Kbd } from '../../components/primitives/index.js';

interface ReplyBarProps {
  session: SessionInfo;
  onSend: (data: string) => void;
}

export function ReplyBar({ session, onSend }: ReplyBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: 'var(--s-2) var(--s-3)',
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--line-2)',
        flexShrink: 0,
      }}
    >
      {session.status === 'waiting' ? (
        <>
          <Button variant="primary" size="sm" onClick={() => onSend('y\r')}>y · accept</Button>
          <Button variant="outline" size="sm" onClick={() => onSend('n\r')}>n · reject</Button>
          <Button variant="ghost" size="sm" onClick={() => onSend('a\r')}>a · always</Button>
        </>
      ) : (
        <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>
          Session is {session.status} — type in the terminal above.
        </span>
      )}
      <div style={{ flex: 1 }} />
      {session.status === 'waiting' && (
        <div className="eyebrow" style={{ color: 'var(--fg-3)' }}>
          or type a reply in terminal <Kbd>↵</Kbd>
        </div>
      )}
    </div>
  );
}
