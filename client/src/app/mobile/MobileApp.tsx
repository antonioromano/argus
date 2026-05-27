import { useEffect, useState } from 'react';
import { useSocket } from '../../hooks/useSocket.js';
import { useSessions } from '../../hooks/useSessions.js';
import { useNgrok } from '../../hooks/useNgrok.js';
import { api, setToken } from '../../services/api.js';
import { reconnectSocket } from '../../hooks/useSocket.js';
import { PasswordGate } from '../PasswordGate.js';
import { Sessions } from './Sessions.js';
import { Focus } from './Focus.js';
import { Remote } from './Remote.js';
import { Diff } from './Diff.js';
import { BottomNav } from './BottomNav.js';
import type { MobileTab } from './BottomNav.js';

export function MobileApp() {
  const socket = useSocket();
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    api.getAuthStatus().then((s) => {
      setAuthRequired(s.required);
      setAuthenticated(s.authenticated ?? !s.required);
      setAuthChecked(true);
    }).catch(() => {
      setAuthRequired(false);
      setAuthenticated(true);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    const handler = (payload: { required: boolean }) => {
      setAuthRequired(payload.required);
      if (!payload.required) {
        setAuthenticated(true);
        setToken(null);
      }
    };
    socket.on('auth:required', handler);
    return () => { socket.off('auth:required', handler); };
  }, [socket]);

  useEffect(() => {
    const handler = () => setAuthenticated(false);
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  if (!authChecked) return null;
  if (authRequired && !authenticated) {
    return <PasswordGate onAuthenticated={() => { setAuthenticated(true); reconnectSocket(); }} />;
  }
  return <Inner />;
}

function Inner() {
  const socket = useSocket();
  const { sessions } = useSessions(socket);
  const { status: ngrokStatus } = useNgrok(socket);
  const [tab, setTab] = useState<MobileTab>('sessions');
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const focused = focusedId ? sessions.find((s) => s.id === focusedId) ?? null : null;
  const publicUrl = ngrokStatus?.tunnelStatus === 'connected' ? ngrokStatus.publicUrl ?? null : null;

  // If focused on a session, render Focus screen exclusively (no bottom nav)
  if (focused) {
    return <Focus session={focused} onBack={() => setFocusedId(null)} />;
  }

  return (
    <>
      <div style={{ paddingBottom: 64 }}>
        {tab === 'sessions' && (
          <Sessions
            sessions={sessions}
            publicUrl={publicUrl}
            onSelect={setFocusedId}
            onRemote={() => setTab('remote')}
          />
        )}
        {tab === 'diff' && <Diff sessions={sessions} />}
        {tab === 'remote' && <Remote onBack={() => setTab('sessions')} />}
      </div>
      <BottomNav active={tab} onChange={setTab} />
    </>
  );
}
