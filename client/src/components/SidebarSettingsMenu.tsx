import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { Settings, Maximize2, Minimize2, Globe, Sun, Moon } from 'lucide-react';

interface SidebarSettingsMenuProps {
  isDark: boolean;
  isFullscreen: boolean;
  ngrokConnected: boolean;
  onOpenSettings: () => void;
  onToggleFullscreen: () => void;
  onOpenRemote: () => void;
  onToggleTheme: () => void;
}

const MENU_WIDTH = 220;
const VIEWPORT_MARGIN = 8;

export function SidebarSettingsMenu({
  isDark,
  isFullscreen,
  ngrokConnected,
  onOpenSettings,
  onToggleFullscreen,
  onOpenRemote,
  onToggleTheme,
}: SidebarSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_MARGIN),
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
    );
    setPosition({ top: rect.bottom + 4, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleViewportChange = () => setOpen(false);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open]);

  const items: { icon: LucideIcon; text: string; onClick: () => void; accent?: boolean }[] = [
    { icon: Settings, text: 'Settings', onClick: onOpenSettings },
    {
      icon: isFullscreen ? Minimize2 : Maximize2,
      text: isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen',
      onClick: onToggleFullscreen,
    },
    { icon: Globe, text: 'Remote Access', onClick: onOpenRemote, accent: ngrokConnected },
    {
      icon: isDark ? Sun : Moon,
      text: isDark ? 'Switch to light theme' : 'Switch to dark theme',
      onClick: onToggleTheme,
    },
  ];

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          padding: '2px',
          display: 'inline-flex',
          borderRadius: 'var(--radius-sm)',
          transition: 'background var(--transition-fast), color var(--transition-fast)',
        }}
        title="Settings menu"
        aria-label="Settings menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--color-bg-elevated)';
          e.currentTarget.style.color = 'var(--color-text-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--color-text-muted)';
        }}
      >
        <Settings size={14} strokeWidth={1.75} />
      </button>

      {open && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${MENU_WIDTH}px`,
            background: 'var(--color-bg-modal)',
            border: '1px solid var(--color-border-base)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            padding: '4px',
            zIndex: 1000,
          }}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.text}
                role="menuitem"
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '6px 10px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  color: item.accent ? 'var(--color-success)' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-sans)',
                  textAlign: 'left',
                  transition: 'background var(--transition-fast)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-elevated)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Icon size={14} strokeWidth={1.75} />
                {item.text}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
