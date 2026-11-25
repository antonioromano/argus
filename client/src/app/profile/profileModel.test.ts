import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig, type ProfilesState } from '@argus/shared';
import {
  activeProfile, avatarText, configPatch, currentSettings, initials, isExistingUser, makeProfile,
  classifyFirstLaunch, profileCardToShow, sameSettings, themeOf, uniqueName,
} from './profileModel.js';

const cfg = (patch: Partial<AppConfig> = {}): AppConfig => ({ ...structuredClone(DEFAULT_CONFIG), ...patch });
const state = (patch: Partial<ProfilesState> = {}): ProfilesState => ({ activeId: null, profiles: [], prompt: 'pending', ...patch });

describe('profile settings', () => {
  it('captures every profile key plus the device theme, and nothing else', () => {
    const s = currentSettings(cfg({ density: 'compact', ptyBackend: 'tmux' }), 'dark', 'github');
    expect(s.density).toBe('compact');
    expect(s.themeMode).toBe('dark');
    expect(s.colorTheme).toBe('github');
    expect(s).not.toHaveProperty('ptyBackend');
    expect(s).not.toHaveProperty('customAgents');
  });

  it('round-trips: a captured profile patches config back to the same values', () => {
    const c = cfg({ codeFontSize: 15, tileQuickAction: 'shell', notifyOnDone: true });
    const patch = configPatch(currentSettings(c, 'light', 'argus'));
    expect(patch).toMatchObject({ codeFontSize: 15, tileQuickAction: 'shell', notifyOnDone: true });
    expect(patch).not.toHaveProperty('themeMode');
    expect(patch).not.toHaveProperty('colorTheme');
  });

  it('leaves keys a profile does not carry out of the patch', () => {
    expect(configPatch({ density: 'compact' })).toEqual({ density: 'compact' });
  });

  it('reads the theme, ignoring an unknown color theme id', () => {
    expect(themeOf({ themeMode: 'dark', colorTheme: 'one' })).toEqual({ mode: 'dark', palette: 'one' });
    expect(themeOf({ colorTheme: 'monokai' })).toEqual({ mode: undefined, palette: undefined });
  });

  it('compares settings by value', () => {
    expect(sameSettings({ density: 'compact' }, { density: 'compact' })).toBe(true);
    expect(sameSettings({ density: 'compact' }, { density: 'default' })).toBe(false);
    expect(sameSettings({ density: 'compact' }, {})).toBe(false);
  });
});

describe('names and avatars', () => {
  it('builds initials from the first and last word', () => {
    expect(initials('Antonio Romano')).toBe('AR');
    expect(initials('Ada Augusta Lovelace')).toBe('AL');
    expect(initials('argus')).toBe('AR');
    expect(initials('   ')).toBe('?');
  });
  it('prefers the emoji avatar', () => {
    expect(avatarText({ name: 'Antonio Romano', avatar: '🦉' })).toBe('🦉');
    expect(avatarText({ name: 'Antonio Romano', avatar: '' })).toBe('AR');
  });
  it('picks an unused name', () => {
    expect(uniqueName('Work', [])).toBe('Work');
    expect(uniqueName('Work', ['work', 'Work 2'])).toBe('Work 3');
  });
  it('never makes a nameless profile', () => {
    expect(makeProfile('  ', {}, 1, 'x').name).toBe('My profile');
  });
});

describe('first run', () => {
  it('finds the active profile', () => {
    const p = makeProfile('Me', {}, 1, 'a');
    expect(activeProfile(state({ activeId: 'a', profiles: [p] }))).toBe(p);
    expect(activeProfile(state())).toBeNull();
  });

  it('tells a new user from an existing one', () => {
    expect(isExistingUser(cfg())).toBe(false);
    expect(isExistingUser(cfg({ introSeen: 'release-0.30' }))).toBe(true);
    expect(isExistingUser(cfg({ quickActionPromptedAt: '0.20.0' }))).toBe(true);
  });

  it('classifies the first launch once: new, existing, or nothing to do', () => {
    expect(classifyFirstLaunch(state(), cfg())).toBe('new');
    expect(classifyFirstLaunch(state(), cfg({ introSeen: 'release-0.30' }))).toBe('existing');
    expect(classifyFirstLaunch(state({ prompt: 'welcome' }), cfg({ introSeen: 'release-0.30' }))).toBeNull();
    expect(classifyFirstLaunch(state({ profiles: [makeProfile('Me', {}, 1)] }), cfg())).toBeNull();
    expect(classifyFirstLaunch(null, cfg())).toBeNull();
  });

  it('shows the Welcome card for a classified new user, never while the intro is up', () => {
    expect(profileCardToShow(state({ prompt: 'welcome' }), false)).toBe('welcome');
    expect(profileCardToShow(state({ prompt: 'welcome' }), true)).toBeNull();
    expect(profileCardToShow(state(), false)).toBeNull();
    expect(profileCardToShow(state({ prompt: 'later' }), false)).toBeNull();
    expect(profileCardToShow(null, false)).toBeNull();
  });

  it('shows the upgrade notice when due', () => {
    expect(profileCardToShow(state({ prompt: 'upgrade', profiles: [makeProfile('Me', {}, 1)] }), false)).toBe('upgrade');
  });
});
