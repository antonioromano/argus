import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { LoadingState, ErrorState } from '../primitives/index.js';

interface ImagePreviewProps {
  filePath: string;
}

/** Read-only image viewer. Fetches through authFetch (the API needs a bearer
 *  header, so a plain <img src> can't hit it) and renders from a blob: URL. */
export function ImagePreview({ filePath }: ImagePreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(null);
    setError(null);
    setSize(null);
    api.getImageBlob(filePath).then(
      (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  if (error) return <ErrorState title="Failed to load image" detail={error} onRetry={retry} />;
  if (!url) return <LoadingState label="Loading image" />;

  return (
    <div
      className="argus-scroll"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--s-3)',
        padding: 'var(--s-5)',
        background: 'var(--bg-0)',
      }}
    >
      <img
        src={url}
        alt={filePath.split('/').pop() ?? ''}
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        onError={() => setError('The file could not be decoded as an image')}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          // Checkerboard so transparent regions are visible in both themes.
          backgroundImage:
            'linear-gradient(45deg, var(--line-2) 25%, transparent 25%), linear-gradient(-45deg, var(--line-2) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--line-2) 75%), linear-gradient(-45deg, transparent 75%, var(--line-2) 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
        }}
      />
      {size && (
        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
          {size.w} × {size.h}
        </div>
      )}
    </div>
  );
}
