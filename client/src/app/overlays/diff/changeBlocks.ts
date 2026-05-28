import type { Chunk, Change, File as DiffFile } from 'parse-diff';
import type { ChunkSelection } from '@argus/shared';

export interface ChangeBlock {
  hash: string;
  chunkIndex: number;
  // 0-based indices into the chunk's add/del-only (no-context) change list.
  changeIndicesInChunk: number[];
  delChanges: Change[];
  addChanges: Change[];
  // first add/del row index inside the chunk (used to position the gutter cell)
  rowIndexInChunk: number;
}

// Tiny synchronous hash (cyrb53). 53-bit; collision-resistant enough for
// our per-file selection store. Stable across browser engines.
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch: number; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const out = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return out.toString(16).padStart(14, '0');
}

function lineText(c: Change): string {
  return c.content.replace(/^[+\- ]/, '');
}

export function hashBlock(filePath: string, dels: Change[], adds: Change[]): string {
  const payload =
    filePath +
    '\n--DEL--\n' +
    dels.map(lineText).join('\n') +
    '\n--ADD--\n' +
    adds.map(lineText).join('\n');
  return cyrb53(payload);
}

/**
 * Walks a chunk's changes, grouping consecutive add/del runs into change-blocks.
 * `changeIndicesInChunk` is 0-based against the chunk's add/del-only sequence,
 * which is exactly the index space `ChunkSelection.selectedChangeIndices` expects.
 */
export function segmentChangeBlocks(filePath: string, chunkIndex: number, chunk: Chunk): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  let dels: Change[] = [];
  let adds: Change[] = [];
  let blockChangeIndices: number[] = [];
  let nextNonCtxIndex = 0;
  let firstRowOfBlock = -1;
  let rowInChunk = 0;

  const flush = () => {
    if (dels.length || adds.length) {
      blocks.push({
        hash: hashBlock(filePath, dels, adds),
        chunkIndex,
        changeIndicesInChunk: blockChangeIndices,
        delChanges: dels,
        addChanges: adds,
        rowIndexInChunk: firstRowOfBlock,
      });
    }
    dels = [];
    adds = [];
    blockChangeIndices = [];
    firstRowOfBlock = -1;
  };

  for (const c of chunk.changes) {
    if (c.type === 'normal') {
      flush();
      rowInChunk += 1;
      continue;
    }
    if (firstRowOfBlock < 0) firstRowOfBlock = rowInChunk;
    blockChangeIndices.push(nextNonCtxIndex);
    nextNonCtxIndex += 1;
    if (c.type === 'del') dels.push(c);
    else adds.push(c);
    rowInChunk += 1;
  }
  flush();
  return blocks;
}

/**
 * Given the parsed diff for a file and the currently checked hash set,
 * produce the ChunkSelection[] payload the server's git-stage-patch endpoint expects.
 * Empty chunks are filtered out.
 */
export function resolveSelectionToChunkIndices(
  filePath: string,
  file: DiffFile,
  checkedHashes: ReadonlySet<string>,
): ChunkSelection[] {
  const out: ChunkSelection[] = [];
  file.chunks.forEach((chunk, ci) => {
    const blocks = segmentChangeBlocks(filePath, ci, chunk);
    const selected: number[] = [];
    for (const b of blocks) {
      if (checkedHashes.has(b.hash)) selected.push(...b.changeIndicesInChunk);
    }
    if (selected.length > 0) {
      selected.sort((a, b) => a - b);
      out.push({ chunkIndex: ci, selectedChangeIndices: selected });
    }
  });
  return out;
}

/**
 * Collect every change-block hash present in a parsed file.
 * Used to garbage-collect stale entries from persisted selection state.
 */
export function collectAllBlockHashes(filePath: string, file: DiffFile): Set<string> {
  const out = new Set<string>();
  file.chunks.forEach((chunk, ci) => {
    for (const b of segmentChangeBlocks(filePath, ci, chunk)) out.add(b.hash);
  });
  return out;
}
