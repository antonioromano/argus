import { useState, useRef, useEffect } from 'react';
import type { SessionInfo } from '@argus/shared';
import { useSocket } from '../../hooks/useSocket.js';

interface MobileActionBarProps {
  session: SessionInfo;
  lastRawLine: string; // last non-empty line from terminal buffer for chip detection
}

interface Chip {
  label: string;
  value: string;
}

function detectChips(lastLine: string, status: string): Chip[] {
  const chips: Chip[] = [];

  if (/\(y\/n\)/i.test(lastLine)) {
    chips.push({ label: 'y — Yes', value: 'y\n' }, { label: 'n — No', value: 'n\n' });
  } else if (/\(yes\/no\)/i.test(lastLine)) {
    chips.push({ label: 'Yes', value: 'yes\n' }, { label: 'No', value: 'no\n' });
  } else if (/press enter/i.test(lastLine) || /\[enter\]/i.test(lastLine)) {
    chips.push({ label: 'Continue ↵', value: '\r' });
  }

  if (status === 'waiting' || status === 'running') {
    chips.push({ label: '⏹ Stop', value: '\x03' }); // Ctrl-C
  }

  return chips;
}

function getChipStyle(chip: Chip): React.CSSProperties {
  const label = chip.label.toLowerCase();
  if (label.startsWith('y') && (label.includes('yes') || label === 'y — yes')) {
    return {
      background: 'rgba(48,209,88,0.15)',
      color: '#30D158',
      border: '1px solid rgba(48,209,88,0.3)',
    };
  }
  if (label.startsWith('n') && (label.includes('no') || label === 'n — no')) {
    return {
      background: 'rgba(255,69,58,0.12)',
      color: '#FF453A',
      border: '1px solid rgba(255,69,58,0.3)',
    };
  }
  if (label.includes('stop')) {
    return {
      background: 'rgba(255,255,255,0.07)',
      color: 'rgba(255,255,255,0.45)',
      border: '1px solid rgba(255,255,255,0.12)',
    };
  }
  // Default (continue, etc.)
  return {
    background: 'rgba(10,132,255,0.12)',
    color: '#0A84FF',
    border: '1px solid rgba(10,132,255,0.3)',
  };
}

export function MobileActionBar({ session, lastRawLine }: MobileActionBarProps) {
  const socket = useSocket();
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const chips = detectChips(lastRawLine, session.status);

  const sendData = (data: string) => {
    socket.emit('session:input', { sessionId: session.id, data });
  };

  const handleChipPress = (chip: Chip) => {
    sendData(chip.value);
  };

  const handleSend = () => {
    const trimmed = inputText;
    if (!trimmed) return;
    sendData(trimmed + '\n');
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  // Resize chips row when chips change to ensure scroll position resets
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chipsRef.current) {
      chipsRef.current.scrollLeft = 0;
    }
  }, [chips.length]);

  return (
    <div
      style={{
        background: 'rgba(28,28,30,0.98)',
        borderTop: '0.5px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        flexShrink: 0,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
      }}
    >
      {/* Chips row — only show when there are chips */}
      {chips.length > 0 && (
        <div
          ref={chipsRef}
          style={{
            display: 'flex',
            gap: 8,
            padding: '8px 12px 4px',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            // Hide scrollbar in webkit
            WebkitOverflowScrolling: 'touch',
          } as React.CSSProperties}
          // Hide scrollbar
          className="mobile-chips-row"
        >
          <style>{`.mobile-chips-row::-webkit-scrollbar { display: none; }`}</style>
          {chips.map((chip) => (
            <button
              key={chip.label}
              onClick={() => handleChipPress(chip)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                fontFamily: 'inherit',
                ...getChipStyle(chip),
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send message…"
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 20,
            padding: '8px 16px',
            fontSize: 15,
            color: 'rgba(255,255,255,0.88)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!inputText}
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: inputText ? '#0A84FF' : 'rgba(10,132,255,0.3)',
            border: 'none',
            cursor: inputText ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
          aria-label="Send"
        >
          {/* Up arrow SVG */}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 12V2M2 7l5-5 5 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
