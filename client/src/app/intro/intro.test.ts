import { describe, it, expect } from 'vitest';
import { CURRENT_INTRO_ID, introToShow } from './intro.js';

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

  it('shows nothing once the current intro has been seen', () => {
    expect(introToShow({ introSeen: CURRENT_INTRO_ID, quickActionPromptedAt: '0.22.0' }, '0.24.0')).toBeNull();
  });
});
