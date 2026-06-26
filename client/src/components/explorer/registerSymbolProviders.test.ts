/* eslint-disable @typescript-eslint/no-explicit-any -- fakes for monaco's editor/provider surfaces */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/api.js', () => ({
  api: { findDefinition: vi.fn(), findReferences: vi.fn(), resolveImport: vi.fn() },
}));

import { api } from '../../services/api.js';
import { registerSymbolProviders, addSymbolEditorActions, symbolNavContext } from './registerSymbolProviders.js';

// Capture the providers/opener handed to a fake monaco singleton.
const captured: { def?: any; ref?: any; opener?: any } = {};

const fakeMonaco = {
  Uri: { parse: (s: string) => ({ path: s }) },
  Range: class {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    constructor(a: number, b: number, c: number, d: number) {
      this.startLineNumber = a;
      this.startColumn = b;
      this.endLineNumber = c;
      this.endColumn = d;
    }
  },
  languages: {
    registerDefinitionProvider: (_lang: string, p: any) => { captured.def = p; },
    registerReferenceProvider: (_lang: string, p: any) => { captured.ref = p; },
  },
  editor: { registerEditorOpener: (o: any) => { captured.opener = o; } },
};

registerSymbolProviders(fakeMonaco as any);

const modelWith = (word: string | null, line = 'const x = foo;') => ({
  getWordAtPosition: () => (word ? { word, startColumn: 1, endColumn: word.length + 1 } : null),
  getLineContent: () => line,
});

beforeEach(() => {
  vi.clearAllMocks();
  symbolNavContext.activePath = '/repo/a.ts';
  symbolNavContext.onOpen = () => {};
});

describe('definition provider', () => {
  it('extracts the word, queries the API, and maps locations to monaco ranges', async () => {
    (api.findDefinition as any).mockResolvedValue({
      symbol: 'foo', truncated: false,
      locations: [{ path: '/repo/b.ts', line: 5, column: 3, preview: 'function foo' }],
    });
    const res = await captured.def.provideDefinition(modelWith('foo'), { lineNumber: 2 });
    expect(api.findDefinition).toHaveBeenCalledWith('/repo/a.ts', 'foo', 2);
    expect(res).toHaveLength(1);
    expect(res[0].uri.path).toBe('/repo/b.ts');
    expect(res[0].range.startLineNumber).toBe(5);
    expect(res[0].range.startColumn).toBe(3);
    expect(res[0].range.endColumn).toBe(3 + 'foo'.length);
  });

  it('resolves an import specifier to its file instead of a word-symbol search', async () => {
    (api.resolveImport as any).mockResolvedValue({ path: '/repo/foo.ts' });
    // column 21 sits inside the './foo' specifier of the import below.
    const model = modelWith('foo', "import { x } from './foo';");
    const res = await captured.def.provideDefinition(model, { lineNumber: 3, column: 21 });
    expect(api.resolveImport).toHaveBeenCalledWith('/repo/a.ts', './foo');
    expect(api.findDefinition).not.toHaveBeenCalled();
    expect(res.uri.path).toBe('/repo/foo.ts');
    expect(res.range.startLineNumber).toBe(1);
  });

  it('returns null (no word fallback) when an import specifier does not resolve', async () => {
    (api.resolveImport as any).mockResolvedValue({ path: null });
    const model = modelWith('foo', "import { x } from './nope';");
    const res = await captured.def.provideDefinition(model, { lineNumber: 1, column: 21 });
    expect(res).toBeNull();
    expect(api.findDefinition).not.toHaveBeenCalled();
  });

  it('returns null when the cursor is not on a word', async () => {
    expect(await captured.def.provideDefinition(modelWith(null), { lineNumber: 1 })).toBeNull();
    expect(api.findDefinition).not.toHaveBeenCalled();
  });

  it('returns null when there is no active file', async () => {
    symbolNavContext.activePath = null;
    expect(await captured.def.provideDefinition(modelWith('foo'), { lineNumber: 1 })).toBeNull();
    expect(api.findDefinition).not.toHaveBeenCalled();
  });
});

describe('reference provider', () => {
  it('maps references to monaco locations', async () => {
    (api.findReferences as any).mockResolvedValue({
      symbol: 'foo', truncated: false,
      locations: [{ path: '/repo/a.ts', line: 1, column: 1, preview: 'foo()' }],
    });
    const res = await captured.ref.provideReferences(modelWith('foo'), { lineNumber: 1 });
    expect(api.findReferences).toHaveBeenCalledWith('/repo/a.ts', 'foo');
    expect(res[0].uri.path).toBe('/repo/a.ts');
  });
});

describe('cross-file opener', () => {
  it('routes a foreign resource through onOpen and reports handled', () => {
    const onOpen = vi.fn();
    symbolNavContext.onOpen = onOpen;
    const handled = captured.opener.openCodeEditor(null, { path: '/repo/b.ts' }, { startLineNumber: 9, startColumn: 1 });
    expect(handled).toBe(true);
    expect(onOpen).toHaveBeenCalledWith('/repo/b.ts', 9);
  });

  it('accepts a bare position (lineNumber) as well as a selection', () => {
    const onOpen = vi.fn();
    symbolNavContext.onOpen = onOpen;
    captured.opener.openCodeEditor(null, { path: '/repo/c.ts' }, { lineNumber: 4, column: 1 });
    expect(onOpen).toHaveBeenCalledWith('/repo/c.ts', 4);
  });
});

describe('editor context-menu actions', () => {
  const makeEditor = (word: string | null) => {
    const actions: Record<string, any> = {};
    const editor: any = {
      addAction: (a: any) => { actions[a.id] = a; },
      getPosition: () => ({ lineNumber: 1, column: 1 }),
      getModel: () => ({ getWordAtPosition: () => (word ? { word } : null) }),
      trigger: vi.fn(),
    };
    addSymbolEditorActions(editor);
    return { editor, actions };
  };

  it('registers the three convenience actions', () => {
    const { actions } = makeEditor('foo');
    expect(Object.keys(actions).sort()).toEqual(['argus.copySymbol', 'argus.findUsages', 'argus.searchWorkspace']);
  });

  it('Copy Symbol Name writes the word to the clipboard', () => {
    const writeText = vi.fn();
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText } }, configurable: true });
    const { editor, actions } = makeEditor('myVar');
    actions['argus.copySymbol'].run(editor);
    expect(writeText).toHaveBeenCalledWith('myVar');
  });

  it('Search Workspace routes the symbol through searchFor', () => {
    const searchFor = vi.fn();
    symbolNavContext.searchFor = searchFor;
    const { editor, actions } = makeEditor('thing');
    actions['argus.searchWorkspace'].run(editor);
    expect(searchFor).toHaveBeenCalledWith('thing');
  });

  it('Find All Usages triggers the native references peek', () => {
    const { editor, actions } = makeEditor('thing');
    actions['argus.findUsages'].run(editor);
    expect(editor.trigger).toHaveBeenCalledWith('argus', 'editor.action.referenceSearch.trigger', {});
  });

  it('actions no-op when the cursor is not on a word', () => {
    const searchFor = vi.fn();
    symbolNavContext.searchFor = searchFor;
    const { editor, actions } = makeEditor(null);
    actions['argus.searchWorkspace'].run(editor);
    actions['argus.findUsages'].run(editor);
    expect(searchFor).not.toHaveBeenCalled();
    expect(editor.trigger).not.toHaveBeenCalled();
  });
});
