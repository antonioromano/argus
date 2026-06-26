import type * as Monaco from 'monaco-editor';
import { api } from '../../services/api.js';

// Per-file context the global providers read. The providers are registered once
// against the monaco singleton; this mutable ref carries the active file + the
// cross-file open callback so we never re-register when the open file changes.
interface SymbolNavContext {
  activePath: string | null;
  /** Open another file in the workbench and reveal a line (cross-file go-to-def). */
  onOpen: (path: string, line: number) => void;
  /** Open the workbench file-search panel pre-seeded with a query (Unit 5). */
  searchFor: (query: string) => void;
}

export const symbolNavContext: SymbolNavContext = {
  activePath: null,
  onOpen: () => {},
  searchFor: () => {},
};

// Code languages we attach providers to. The backend still handles language
// detail per file; unknown languages degrade to a weak whole-word search.
const PROVIDER_LANGUAGES = [
  'typescript', 'javascript', 'python', 'ruby', 'go', 'rust',
  'java', 'c', 'cpp', 'csharp', 'php', 'swift', 'kotlin',
];

let registered = false;

/**
 * If `position` sits inside the quoted specifier of an import/require/from on its line,
 * return that specifier (e.g. `./foo`), else null. Routes cmd+click on a module path to
 * file resolution instead of the inaccurate word-symbol search.
 */
function importSpecifierAt(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): string | null {
  const line = model.getLineContent(position.lineNumber);
  if (!/\b(?:from|import|require)\b/.test(line)) return null;
  const re = /(['"])(.*?)\1/g;
  const col0 = position.column - 1;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (col0 >= m.index && col0 <= m.index + m[0].length) return m[2];
  }
  return null;
}

/** Register go-to-definition / find-references providers + the cross-file opener. Idempotent. */
export function registerSymbolProviders(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;

  const definitionProvider: Monaco.languages.DefinitionProvider = {
    async provideDefinition(model, position) {
      const activePath = symbolNavContext.activePath;
      if (!activePath) return null;

      // Module path under the cursor (e.g. `from './foo'`) → resolve to the real file
      // and jump there. Handle this before the word search, which greps for a fragment
      // of the path (e.g. `foo`) and lands on the wrong symbol.
      const specifier = importSpecifierAt(model, position);
      if (specifier) {
        try {
          const { path: resolved } = await api.resolveImport(activePath, specifier);
          if (resolved) {
            return { uri: monaco.Uri.parse(resolved), range: new monaco.Range(1, 1, 1, 1) };
          }
        } catch {
          // ignore — an unresolved specifier isn't a symbol either
        }
        return null; // don't fall through to a misleading word-symbol search
      }

      const word = model.getWordAtPosition(position);
      if (!word) return null;
      try {
        const res = await api.findDefinition(activePath, word.word, position.lineNumber);
        return res.locations.map((loc) => ({
          uri: monaco.Uri.parse(loc.path),
          range: new monaco.Range(loc.line, loc.column, loc.line, loc.column + word.word.length),
        }));
      } catch {
        return null;
      }
    },
  };

  const referenceProvider: Monaco.languages.ReferenceProvider = {
    async provideReferences(model, position) {
      const word = model.getWordAtPosition(position);
      const activePath = symbolNavContext.activePath;
      if (!word || !activePath) return null;
      try {
        const res = await api.findReferences(activePath, word.word);
        return res.locations.map((loc) => ({
          uri: monaco.Uri.parse(loc.path),
          range: new monaco.Range(loc.line, loc.column, loc.line, loc.column + word.word.length),
        }));
      } catch {
        return null;
      }
    },
  };

  for (const lang of PROVIDER_LANGUAGES) {
    monaco.languages.registerDefinitionProvider(lang, definitionProvider);
    monaco.languages.registerReferenceProvider(lang, referenceProvider);
  }

  // Monaco only calls this when the target is a resource OTHER than the current
  // model (i.e. cross-file go-to-definition). Same-file jumps stay native.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      const targetPath = resource.path;
      if (!targetPath) return false;
      let line = 1;
      if (selectionOrPosition) {
        line = 'startLineNumber' in selectionOrPosition
          ? selectionOrPosition.startLineNumber
          : selectionOrPosition.lineNumber;
      }
      symbolNavContext.onOpen(targetPath, line);
      return true;
    },
  });
}

/** The symbol under the cursor, or null. */
function wordAtCursor(editor: Monaco.editor.ICodeEditor): string | null {
  const pos = editor.getPosition();
  const model = editor.getModel();
  if (!pos || !model) return null;
  return model.getWordAtPosition(pos)?.word ?? null;
}

/**
 * Add the right-click symbol actions to an editor instance. Go-to-Definition and
 * Find-All-References come free from the registered providers; these add the
 * remaining IDE conveniences. Safe to call on every editor mount (actions are
 * scoped to the editor and disposed with it).
 */
export function addSymbolEditorActions(editor: Monaco.editor.IStandaloneCodeEditor): void {
  editor.addAction({
    id: 'argus.findUsages',
    label: 'Find All Usages',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.5,
    run: (ed) => {
      if (!wordAtCursor(ed)) return;
      // Reuse Monaco's native references peek, driven by our reference provider.
      ed.trigger('argus', 'editor.action.referenceSearch.trigger', {});
    },
  });

  editor.addAction({
    id: 'argus.copySymbol',
    label: 'Copy Symbol Name',
    contextMenuGroupId: '9_cutcopypaste',
    contextMenuOrder: 3,
    run: (ed) => {
      const word = wordAtCursor(ed);
      if (word) void navigator.clipboard?.writeText(word);
    },
  });

  editor.addAction({
    id: 'argus.searchWorkspace',
    label: 'Search Workspace for Symbol',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.6,
    run: (ed) => {
      const word = wordAtCursor(ed);
      if (word) symbolNavContext.searchFor(word);
    },
  });
}
