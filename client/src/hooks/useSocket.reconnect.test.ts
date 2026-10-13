import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';


// A minimal stand-in for a socket.io-client Socket: records handlers and
// connect/disconnect calls so the reconnect policy can be driven directly.
const fake = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  connected: false,
  active: true,
  auth: {} as unknown,
  connects: 0,
  on(ev: string, fn: (...args: unknown[]) => void) { this.handlers.set(ev, fn); return this; },
  off() { return this; },
  connect() { this.connects++; return this; },
  disconnect() { this.connected = false; return this; },
  io: { on() {}, off() {} },
}));

vi.mock('socket.io-client', () => ({ io: vi.fn(() => fake) }));

describe('useSocket reconnect after a server-side drop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    fake.handlers.clear();
    fake.connects = 0;
    fake.connected = false;
    fake.active = true;
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  async function load() {
    const mod = await import('./useSocket.js');
    mod.getSocket();
    fake.connects = 0;
    return mod;
  }

  // First: window listeners from earlier tests' module instances would also fire.
  it('reconnects immediately when this window authenticates', async () => {
    await load();
    window.dispatchEvent(new CustomEvent('auth:authenticated'));
    expect(fake.connects).toBe(1);
  });

  it('reconnects with the latest token after the server disconnects it', async () => {
    await load();
    localStorage.setItem('orchestrator_auth_token', 'fresh-token');
    fake.handlers.get('disconnect')!('io server disconnect');
    vi.advanceTimersByTime(999);
    expect(fake.connects).toBe(0);
    vi.advanceTimersByTime(1);
    expect(fake.connects).toBe(1);
    expect(fake.auth).toEqual({ token: 'fresh-token' });
  });

  it('retries after a middleware rejection (socket inactive), not after a transport blip', async () => {
    await load();
    fake.handlers.get('disconnect')!('transport close');
    vi.advanceTimersByTime(5000);
    expect(fake.connects).toBe(0);

    fake.active = false;
    fake.handlers.get('connect_error')!(new Error('Authentication required'));
    vi.advanceTimersByTime(3000);
    expect(fake.connects).toBe(1);
  });

});
