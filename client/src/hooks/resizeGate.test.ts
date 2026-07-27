import { describe, it, expect } from 'vitest';
import { ResizeEmitGate } from './resizeGate.js';

describe('ResizeEmitGate', () => {
  it('emits the first geometry it sees', () => {
    const gate = new ResizeEmitGate();
    expect(gate.request(120, 30)).toBe(true);
  });

  it('swallows a repeat of the geometry it already sent', () => {
    const gate = new ResizeEmitGate();
    gate.request(120, 30);
    expect(gate.request(120, 30)).toBe(false);
  });

  it('emits when either axis actually changes', () => {
    const gate = new ResizeEmitGate();
    gate.request(120, 30);
    expect(gate.request(120, 31)).toBe(true);
    expect(gate.request(200, 31)).toBe(true);
  });

  it('emits an unchanged geometry when forced (reconnect: the server lost our size)', () => {
    const gate = new ResizeEmitGate();
    gate.request(120, 30);
    expect(gate.request(120, 30, { force: true })).toBe(true);
  });

  it('withholds mid-drag sizes and emits the geometry once the drag ends', () => {
    const gate = new ResizeEmitGate();
    gate.request(120, 30);

    expect(gate.request(90, 30, { suspended: true })).toBe(false);
    expect(gate.request(70, 30, { suspended: true })).toBe(false);
    // Drag released: the final size still counts as new, because nothing
    // withheld was ever recorded as sent.
    expect(gate.request(70, 30)).toBe(true);
  });

  it('still swallows a released size that matches what was last sent', () => {
    const gate = new ResizeEmitGate();
    gate.request(120, 30);
    gate.request(90, 30, { suspended: true });

    expect(gate.request(120, 30)).toBe(false);
  });
});
