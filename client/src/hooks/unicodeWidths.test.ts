import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { enableUnicode11 } from './unicodeWidths';

const write = (t: Terminal, s: string) => new Promise<void>((r) => t.write(s, r));

describe('enableUnicode11', () => {
  it('gives emoji two columns, matching the agent and the server mirror', async () => {
    const t = new Terminal({ cols: 20, rows: 3, allowProposedApi: true });
    enableUnicode11(t);
    for (const ch of ['👉', '✅']) {
      await write(t, `\x1b[H\x1b[2K${ch}X`);
      expect(t.buffer.active.getLine(0)!.getCell(2)?.getChars()).toBe('X');
    }
    t.dispose();
  });
});
