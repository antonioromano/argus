import { describe, it, expect } from 'vitest';
import { CURRENT_INTRO_ID, introConfigPatch, introToShow } from './intro.js';

describe('introToShow', () => {
  it('waits until both config and version are known', () => {
    expect(introToShow(null, '0.24.0')).toBeNull();
    expect(introToShow({ introSeen: '', quickActionPromptedAt: '' }, undefined)).toBeNull();
  });

  it('welcomes a brand-new user who has answered no one-time prompt', () => {
    expect(introToShow({ introSeen: '', quickActionPromptedAt: '' }, '0.24.0')).toBe('welcome');
  });

  it('shows What’s new to an existing user who has not seen this intro', () => {
    expect(introToShow({ introSeen: '', quickActionPromptedAt: '0.22.0' }, '0.24.0')).toBe('whatsNew');
    expect(introToShow({ introSeen: 'older-intro', quickActionPromptedAt: '' }, '0.24.0')).toBe('whatsNew');
  });

  it('re-shows What’s new to a user who finished an earlier intro', () => {
    expect(CURRENT_INTRO_ID).toBe('release-0.30');
    expect(introToShow({ introSeen: 'beta-features', quickActionPromptedAt: '0.27.0' }, '0.30.0')).toBe('whatsNew');
    expect(introToShow({ introSeen: 'chat-view', quickActionPromptedAt: '0.27.0' }, '0.30.0')).toBe('whatsNew');
  });

  it('still welcomes a brand-new user rather than showing What’s new', () => {
    expect(introToShow({ introSeen: '', quickActionPromptedAt: '' }, '0.29.0')).toBe('welcome');
  });

  it('shows nothing once the current intro has been seen', () => {
    expect(introToShow({ introSeen: CURRENT_INTRO_ID, quickActionPromptedAt: '0.22.0' }, '0.24.0')).toBeNull();
  });
});

describe('introConfigPatch', () => {
  it('stamps the intro as seen and keeps an existing quick-action stamp', () => {
    expect(introConfigPatch({}, '0.22.0', '0.30.0')).toEqual({ introSeen: CURRENT_INTRO_ID });
  });

  it('stamps the quick-action prompt for a user who never had it', () => {
    expect(introConfigPatch({}, '', '0.30.0')).toEqual({ introSeen: CURRENT_INTRO_ID, quickActionPromptedAt: '0.30.0' });
  });

  it('saves Chat by default in the same patch as introSeen', () => {
    expect(introConfigPatch({ defaultSessionView: 'chat' }, '0.22.0', '0.30.0'))
      .toEqual({ introSeen: CURRENT_INTRO_ID, defaultSessionView: 'chat' });
  });

  it('saves the Welcome terminal defaults', () => {
    expect(introConfigPatch({ defaults: { runMode: 'direct', terminalEngine: 'web' } }, '0.22.0', '0.30.0'))
      .toEqual({ introSeen: CURRENT_INTRO_ID, defaultRunMode: 'direct', defaultTerminalEngine: 'web' });
  });
});
