import { useRef, useState } from 'react';
import { Check, UserPen, UserPlus, UserRound } from 'lucide-react';
import type { ProfilesState } from '@argus/shared';
import { ContextMenu, Icon, Tooltip } from '../../components/primitives/index.js';
import type { ContextMenuEntry } from '../../components/primitives/index.js';
import { activeProfile, avatarText } from './profileModel.js';

interface ProfileAvatarProps {
  state: ProfilesState | null;
  /** No profile yet: open the guided setup instead of the menu. */
  onSetup: () => void;
  onSwitch: (id: string) => void;
  onEdit: () => void;
  onNew: () => void;
}

/**
 * The profile avatar at the right end of the toolbar. With no profile it is a
 * dashed placeholder that starts setup (with a dot once setup was put off);
 * otherwise it opens a menu to switch, edit or add a profile.
 */
export function ProfileAvatar({ state, onSetup, onSwitch, onEdit, onNew }: ProfileAvatarProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const active = activeProfile(state);

  if (!state) return null;

  if (!active) {
    return (
      <Tooltip content="Set up your profile">
        <button type="button" className="argus-avatar" data-empty="" onClick={onSetup} aria-label="Set up your profile">
          <Icon icon={UserRound} size="sm" />
          {state.prompt === 'later' && <span className="argus-avatar-pip" aria-hidden />}
        </button>
      </Tooltip>
    );
  }

  const open = () => {
    const r = btnRef.current?.getBoundingClientRect();
    setMenuAt(r ? { x: r.right - 220, y: r.bottom + 6 } : { x: 0, y: 40 });
  };

  const items: ContextMenuEntry[] = [
    { header: 'Profiles' },
    ...state.profiles.map((p) => ({
      id: `profile-${p.id}`,
      label: p.avatar ? `${p.avatar}  ${p.name}` : p.name,
      icon: p.id === active.id ? Check : UserRound,
      onClick: () => { if (p.id !== active.id) onSwitch(p.id); },
    })),
    { separator: true },
    { id: 'profile-edit', label: 'Edit profile…', icon: UserPen, onClick: onEdit },
    { id: 'profile-new', label: 'New profile…', icon: UserPlus, onClick: onNew },
  ];

  return (
    <>
      <Tooltip content={`Profile: ${active.name}`}>
        <button
          ref={btnRef}
          type="button"
          className="argus-avatar"
          onClick={() => (menuAt ? setMenuAt(null) : open())}
          aria-label={`Profile: ${active.name}`}
          aria-haspopup="menu"
        >
          {avatarText(active)}
        </button>
      </Tooltip>
      {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={items} onClose={() => setMenuAt(null)} anchor={btnRef} />}
    </>
  );
}
