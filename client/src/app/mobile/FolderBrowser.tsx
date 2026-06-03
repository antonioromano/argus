import { useEffect, useState } from 'react';
import type { DirectoryChildrenResponse } from '@argus/shared';
import { Folder, ChevronRight, ArrowUp, X, Check } from 'lucide-react';
import { api } from '../../services/api.js';
import { LoadingState, ErrorState } from '../../components/primitives/index.js';

interface FolderBrowserProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/**
 * Server-backed Mac folder picker. The Argus server runs on the Mac, so
 * `api.getDirectoryChildren` (GET /fs/children, not session-scoped) lets the
 * phone walk the whole directory tree — the mobile stand-in for the native
 * folder dialog, which a browser can't open.
 */
export function FolderBrowser({ initialPath, onSelect, onClose }: FolderBrowserProps) {
  const [path, setPath] = useState<string | undefined>(initialPath);
  const [data, setData] = useState<DirectoryChildrenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Clear the list the moment we navigate, so LoadingState shows for the new
  // folder rather than the previous one (setState-during-render, not in effect).
  const [shownPath, setShownPath] = useState(path);
  if (shownPath !== path) {
    setShownPath(path);
    setData(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    api.getDirectoryChildren(path)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError('Cannot read this folder'); });
    return () => { cancelled = true; };
  }, [path, tick]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const current = data?.parentPath ?? '';
  const atRoot = current === '/' || current === '';
  const folders = data?.entries.filter((e) => !e.isFile) ?? [];
  const goUp = () => { if (current && !atRoot) setPath(current.replace(/\/[^/]+$/, '') || '/'); };

  return (
    <div
      className="glass-overlay"
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-tooltip)',
        display: 'flex', flexDirection: 'column', background: 'var(--bg-0)',
        animation: 'argus-sheet-up var(--dur-base) var(--ease-out)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s-2)',
          padding: '0 var(--s-3)', paddingTop: 'env(safe-area-inset-top, 0px)', minHeight: 52,
          background: 'var(--bg-1)', borderBottom: '1px solid var(--line-2)', flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Cancel"
          style={{ background: 'transparent', border: '1px solid var(--line-2)', cursor: 'pointer', color: 'var(--fg-2)', borderRadius: 'var(--r-2)', width: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
        <span className="eyebrow" style={{ flex: 1, fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>CHOOSE FOLDER</span>
        <button
          onClick={goUp}
          disabled={atRoot}
          aria-label="Up one level"
          style={{ background: 'transparent', border: '1px solid var(--line-2)', cursor: atRoot ? 'default' : 'pointer', color: atRoot ? 'var(--fg-4)' : 'var(--accent)', borderRadius: 'var(--r-2)', width: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <ArrowUp size={16} strokeWidth={1.8} />
        </button>
      </div>

      {/* Current path */}
      <div
        style={{
          padding: '8px var(--s-4)', background: 'var(--bg-1)', borderBottom: '1px solid var(--line-1)',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--fg-2)', flexShrink: 0,
          direction: 'rtl', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        <span style={{ direction: 'ltr', unicodeBidi: 'plaintext' as React.CSSProperties['unicodeBidi'] }}>{current || '…'}</span>
      </div>

      {/* List */}
      <div className="argus-scroll" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {error && <ErrorState title="Folder error" detail={error} onRetry={() => { setError(null); setTick((t) => t + 1); }} />}
        {!error && !data && <LoadingState label="Reading folder" />}
        {!error && data && folders.length === 0 && (
          <div style={{ padding: 'var(--s-6) var(--s-4)', textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
            No subfolders here.
          </div>
        )}
        {folders.map((entry) => (
          <button
            key={entry.path}
            onClick={() => entry.hasChildren && setPath(entry.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%', textAlign: 'left',
              padding: 'var(--s-3) var(--s-4)', background: 'transparent', border: 'none',
              borderBottom: '1px solid var(--line-1)', cursor: entry.hasChildren ? 'pointer' : 'default', minHeight: 52,
            }}
          >
            <Folder size={18} strokeWidth={1.6} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-base)', color: 'var(--fg-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.name}
            </span>
            {entry.hasChildren && <ChevronRight size={16} strokeWidth={1.6} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />}
          </button>
        ))}
      </div>

      {/* Footer — select the folder we're currently inside */}
      <div style={{ padding: 'var(--s-3) var(--s-4)', paddingBottom: 'calc(var(--s-3) + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--line-2)', background: 'var(--bg-1)', flexShrink: 0 }}>
        <button
          onClick={() => current && onSelect(current)}
          disabled={!current}
          style={{
            width: '100%', padding: 13, borderRadius: 'var(--r-2)', border: 'none',
            background: current ? 'var(--accent)' : 'var(--bg-3)',
            color: current ? 'var(--fg-on-accent)' : 'var(--fg-4)',
            fontFamily: 'var(--font-sans)', fontSize: 'var(--t-md)', fontWeight: 700,
            cursor: current ? 'pointer' : 'default',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <Check size={16} strokeWidth={2} />
          Use {current ? current.split('/').filter(Boolean).pop() || '/' : 'this folder'}
        </button>
      </div>
    </div>
  );
}
