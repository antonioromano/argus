import { describe, it, expect, vi } from 'vitest';
import { resolveMarkdownLink, dispatchMarkdownLink } from './resolveMarkdownLink.js';

const ROOT = '/repo';
const FILE = '/repo/docs/a.md';

describe('resolveMarkdownLink', () => {
  it('resolves a sibling relative link against the file dir', () => {
    expect(resolveMarkdownLink('./other.md', FILE, ROOT)).toEqual({ kind: 'internal', path: '/repo/docs/other.md' });
    expect(resolveMarkdownLink('other.md', FILE, ROOT)).toEqual({ kind: 'internal', path: '/repo/docs/other.md' });
  });

  it('resolves ../ against the file dir', () => {
    expect(resolveMarkdownLink('../src/x.ts', FILE, ROOT)).toEqual({ kind: 'internal', path: '/repo/src/x.ts' });
  });

  it('resolves a leading-slash link against the session root', () => {
    expect(resolveMarkdownLink('/README.md', FILE, ROOT)).toEqual({ kind: 'internal', path: '/repo/README.md' });
  });

  it('strips a trailing #anchor from an internal link', () => {
    expect(resolveMarkdownLink('./a.md#section', FILE, ROOT)).toEqual({ kind: 'internal', path: '/repo/docs/a.md' });
  });

  it('treats a bare #anchor as an in-page anchor', () => {
    expect(resolveMarkdownLink('#heading', FILE, ROOT)).toEqual({ kind: 'anchor', id: 'heading' });
    expect(resolveMarkdownLink('#my%20heading', FILE, ROOT)).toEqual({ kind: 'anchor', id: 'my heading' });
  });

  it('classifies scheme URLs as external', () => {
    expect(resolveMarkdownLink('https://example.com', FILE, ROOT)).toEqual({ kind: 'external', href: 'https://example.com' });
    expect(resolveMarkdownLink('mailto:x@y.z', FILE, ROOT)).toEqual({ kind: 'external', href: 'mailto:x@y.z' });
    expect(resolveMarkdownLink('//cdn.example.com/x', FILE, ROOT)).toEqual({ kind: 'external', href: '//cdn.example.com/x' });
  });

  it('clamps over-.. at root (no path escape)', () => {
    expect(resolveMarkdownLink('../../../../etc/passwd', FILE, ROOT)).toEqual({ kind: 'internal', path: '/etc/passwd' });
  });
});

describe('dispatchMarkdownLink', () => {
  const handlers = () => ({ openExternal: vi.fn(), openInternal: vi.fn(), scrollToAnchor: vi.fn() });

  it('routes internal link to openInternal only (R2)', () => {
    const h = handlers();
    dispatchMarkdownLink({ kind: 'internal', path: '/repo/x.ts' }, h);
    expect(h.openInternal).toHaveBeenCalledWith('/repo/x.ts');
    expect(h.openExternal).not.toHaveBeenCalled();
    expect(h.scrollToAnchor).not.toHaveBeenCalled();
  });

  it('routes external link to openExternal only (R3)', () => {
    const h = handlers();
    dispatchMarkdownLink({ kind: 'external', href: 'https://x.dev' }, h);
    expect(h.openExternal).toHaveBeenCalledWith('https://x.dev');
    expect(h.openInternal).not.toHaveBeenCalled();
  });

  it('routes anchor to scrollToAnchor only (R4)', () => {
    const h = handlers();
    dispatchMarkdownLink({ kind: 'anchor', id: 'section' }, h);
    expect(h.scrollToAnchor).toHaveBeenCalledWith('section');
    expect(h.openInternal).not.toHaveBeenCalled();
  });
});
