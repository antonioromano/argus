import { useState, useEffect } from 'react';
import { PasswordGate } from '../PasswordGate.js';
import { api } from '../../services/api.js';
import { useSocket } from '../../hooks/useSocket.js';
import { Loader2 } from 'lucide-react';
import { MobileSessionList } from './MobileSessionList.js';
import { MobileTerminalView } from './MobileTerminalView.js';
import { MobileRemoteAccess } from './MobileRemoteAccess.js';

type MobileView =
  | 'list'
  | { view: 'terminal'; sessionId: string }
  | 'remote-access';

export function MobileApp() {
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentView, setCurrentView] = useState<MobileView>('list');

  const socket = useSocket();

  // Same auth check as main App.tsx
  useEffect(() => {
    api.getAuthStatus().then((status) => {
      setAuthRequired(status.required);
      setAuthenticated(status.authenticated ?? !status.required);
      setAuthChecked(true);
    }).catch(() => {
      setAuthRequired(false);
      setAuthenticated(true);
      setAuthChecked(true);
    });
  }, []);

  if (!authChecked) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#1C1C1E' }}>
      <Loader2 size={24} style={{ color: 'rgba(255,255,255,0.3)', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (authRequired && !authenticated) {
    return <PasswordGate onAuthenticated={() => { setAuthenticated(true); }} />;
  }

  return (
    <div
      style={{
        height: '100dvh',
        overflow: 'hidden',
        background: '#1C1C1E',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
      }}
    >
      {currentView === 'list' && (
        <MobileSessionList
          socket={socket}
          onSelectSession={(sessionId) => setCurrentView({ view: 'terminal', sessionId })}
          onRemoteAccess={() => setCurrentView('remote-access')}
        />
      )}

      {currentView === 'remote-access' && (
        <MobileRemoteAccess
          onBack={() => setCurrentView('list')}
        />
      )}

      {typeof currentView === 'object' && currentView.view === 'terminal' && (
        <MobileTerminalView
          socket={socket}
          sessionId={currentView.sessionId}
          onBack={() => setCurrentView('list')}
        />
      )}
    </div>
  );
}
