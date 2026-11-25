import { Button } from '../../components/primitives/index.js';
import type { ProfileCard } from './profileModel.js';

interface ProfilePromptCardProps {
  kind: Exclude<ProfileCard, null>;
  version?: string;
  onOpen: () => void;
  onLater: () => void;
}

const STEPS = ['Theme', 'Look', 'Session header', 'Usage meter', 'Sessions', 'Notifications'];

/**
 * First-run (or first-after-upgrade) invitation to the profile. A corner card,
 * not a modal: the app stays usable behind it, and dismissing it never asks again.
 */
export function ProfilePromptCard({ kind, version, onOpen, onLater }: ProfilePromptCardProps) {
  const welcome = kind === 'welcome';
  return (
    <div className="argus-profile-card material-float" role="dialog" aria-label={welcome ? 'Make Argus yours' : 'Your look and feel, in one place'}>
      <div className="eyebrow" style={{ color: 'var(--accent)' }}>
        {welcome ? 'Welcome to Argus' : `New${version ? ` in v${version}` : ''}`}
      </div>
      <h3>{welcome ? 'Make Argus yours' : 'Your look & feel, in one place'}</h3>
      <p>
        {welcome
          ? 'Pick a theme, what every session header shows and when Argus should notify you. About a minute; every step can be skipped.'
          : 'Your theme, session header and notification choices are now your profile. Nothing changed. Take a look, or open it from your avatar any time.'}
      </p>
      {welcome && (
        <div className="argus-profile-card-chips">
          {STEPS.map((s) => <span key={s}>{s}</span>)}
        </div>
      )}
      <div className="argus-profile-card-actions">
        <Button variant="ghost" onClick={onLater}>{welcome ? 'Later' : 'Not now'}</Button>
        <Button variant="primary" onClick={onOpen}>{welcome ? 'Set up profile' : 'See my profile'}</Button>
      </div>
    </div>
  );
}
