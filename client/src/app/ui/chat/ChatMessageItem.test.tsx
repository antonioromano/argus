import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessage } from '@argus/shared';

const getImageBlob = vi.fn();
vi.mock('../../../services/api.js', () => ({ api: { getImageBlob: (p: string) => getImageBlob(p) } }));

const { ChatMessageItem } = await import('./ChatMessageItem.js');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
  URL.createObjectURL = vi.fn(() => 'blob:thumb');
  URL.revokeObjectURL = vi.fn();
  getImageBlob.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const message = (blocks: ChatMessage['blocks']): ChatMessage => ({ id: 'm1', role: 'user', blocks });

async function render(m: ChatMessage) {
  await act(async () => { root.render(<ChatMessageItem message={m} showRole />); });
}

describe('ChatMessageItem — images', () => {
  it('shows a thumbnail when the image file is readable', async () => {
    getImageBlob.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    await render(message([{ kind: 'image', path: '/repo/shot.png' }]));
    expect(getImageBlob).toHaveBeenCalledWith('/repo/shot.png');
    expect(container.querySelector('[data-testid="chat-image"]')?.getAttribute('src')).toBe('blob:thumb');
  });

  it('keeps the chip when the file cannot be read, or has no path', async () => {
    getImageBlob.mockRejectedValue(new Error('403'));
    await render(message([{ kind: 'image', path: '/repo/gone.png' }, { kind: 'image' }]));
    expect(container.querySelector('[data-testid="chat-image"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('.argus-chat-chip')).map((c) => c.textContent?.trim())).toEqual(['image', 'image']);
    expect(getImageBlob).toHaveBeenCalledTimes(1);
  });

  it('renders a leading list item as a list', async () => {
    await render(message([{ kind: 'text', text: '- first\n- second' }]));
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });
});
