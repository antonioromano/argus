import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readViewMode, readStoredViewMode, writeViewMode, useChatViewMode, type SessionViewMode } from './useChatViewMode.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

describe('session view mode storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to the terminal', () => {
    expect(readViewMode('s1')).toBe('terminal');
    expect(readStoredViewMode('s1')).toBeUndefined();
  });

  it('falls back to the given default when a session has no choice', () => {
    expect(readViewMode('s1', 'chat')).toBe('chat');
  });

  it('stores both choices explicitly, so they beat the default', () => {
    writeViewMode('s1', 'chat');
    expect(readViewMode('s1')).toBe('chat');
    expect(readViewMode('s2')).toBe('terminal');
    writeViewMode('s1', 'terminal');
    expect(readViewMode('s1', 'chat')).toBe('terminal');
    expect(window.localStorage.getItem('argus.sessionViewMode')).toBe('{"s1":"terminal"}');
  });

  it('keeps choices saved before both modes were stored', () => {
    window.localStorage.setItem('argus.sessionViewMode', '{"old":"chat"}');
    expect(readViewMode('old', 'terminal')).toBe('chat');
  });

  it('treats an array in storage as empty and still remembers new choices', () => {
    window.localStorage.setItem('argus.sessionViewMode', '[]');
    writeViewMode('s1', 'terminal');
    expect(readViewMode('s1', 'chat')).toBe('terminal');
  });

  it('ignores unknown stored values', () => {
    window.localStorage.setItem('argus.sessionViewMode', '{"s1":"split"}');
    expect(readViewMode('s1', 'chat')).toBe('chat');
  });

  it('survives corrupt storage', () => {
    window.localStorage.setItem('argus.sessionViewMode', '{nope');
    expect(readViewMode('s1')).toBe('terminal');
    writeViewMode('s1', 'chat');
    expect(readViewMode('s1')).toBe('chat');
  });
});

describe('useChatViewMode', () => {
  let container: HTMLDivElement; let root: Root;
  let result: [SessionViewMode | null, (mode: SessionViewMode) => void];
  function Probe({ id, fallback }: { id: string; fallback: SessionViewMode | null }) {
    result = useChatViewMode(id, fallback);
    return null;
  }
  const render = (id: string, fallback: SessionViewMode | null) => act(() => { root.render(<Probe id={id} fallback={fallback} />); });

  beforeEach(() => {
    window.localStorage.clear();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); });

  it('follows the default live until the session picks a view', () => {
    render('s1', 'terminal');
    expect(result[0]).toBe('terminal');
    render('s1', 'chat'); // config loaded or changed
    expect(result[0]).toBe('chat');
    act(() => result[1]('terminal'));
    expect(result[0]).toBe('terminal');
    render('s1', 'chat');
    expect(result[0]).toBe('terminal');
  });

  it('is pending while the default is unknown, unless the session has a choice', () => {
    render('s1', null);
    expect(result[0]).toBeNull();
    render('s1', 'chat');
    expect(result[0]).toBe('chat');
    writeViewMode('s2', 'terminal');
    render('s2', null);
    expect(result[0]).toBe('terminal');
  });

  it('reads the stored choice of the session it switches to', () => {
    writeViewMode('s2', 'chat');
    render('s1', 'terminal');
    expect(result[0]).toBe('terminal');
    render('s2', 'terminal');
    expect(result[0]).toBe('chat');
  });
});
