import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { registerSymbolProviders, addSymbolEditorActions, symbolNavContext } from './registerSymbolProviders.js';

// Use locally-bundled Monaco rather than the default CDN loader (works offline / in Electron).
loader.config({ monaco });

interface MonacoPaneProps {
  value: string;
  onChange: (next: string) => void;
  language: string;
  theme: 'dark' | 'light';
  readOnly?: boolean;
  onSaveShortcut?: () => void;
  /** Absolute path of the open file — sets the model URI (so same-file go-to-def
   *  stays native) and the symbol-nav context the providers read. */
  path: string;
  revealLine?: number;
  /** Bump to force a re-reveal even when revealLine is unchanged (same-line jumps). */
  revealNonce?: number;
}

export function MonacoPane({ value, onChange, language, theme, readOnly, onSaveShortcut, path, revealLine, revealNonce }: MonacoPaneProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  // Reveal + position the cursor on a line and flash-highlight the whole row
  // (used when jumping in from a search result).
  const revealAndHighlight = (editor: monaco.editor.IStandaloneCodeEditor, line: number) => {
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    decoRef.current?.clear();
    decoRef.current = editor.createDecorationsCollection([
      { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'argus-line-flash' } },
    ]);
  };

  // Register the Argus editor theme once. Background matches --bg-inset (#0a0b0d)
  // so the editor well lines up with the inset terminals/code wells.
  useEffect(() => {
    monaco.editor.defineTheme('argus-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0a0b0d',
      },
    });
  }, []);

  // Keep the symbol-nav context pointed at the file shown in this editor, so the
  // (globally registered) definition/reference providers resolve against it.
  useEffect(() => {
    symbolNavContext.activePath = path;
  }, [path]);

  // Imperatively reveal + highlight line when revealLine OR revealNonce changes.
  // revealNonce covers jumps to the same line (search re-hit, cross-file open to
  // an identical line number) that a bare revealLine dependency would swallow.
  useEffect(() => {
    if (!revealLine || !editorRef.current) return;
    revealAndHighlight(editorRef.current, revealLine);
  }, [revealLine, revealNonce]);

  return (
    <Editor
      value={value}
      path={path}
      language={language}
      theme={theme === 'dark' ? 'argus-dark' : 'vs'}
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor, monacoInstance) => {
        editorRef.current = editor;
        registerSymbolProviders(monacoInstance);
        addSymbolEditorActions(editor);
        symbolNavContext.activePath = path;
        if (onSaveShortcut) {
          editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
            onSaveShortcut();
          });
        }
        if (revealLine) {
          revealAndHighlight(editor, revealLine);
        }
      }}
      options={{
        readOnly,
        fontFamily: 'var(--font-mono), Menlo, monospace',
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: language === 'markdown' ? 'on' : 'off',
        tabSize: 2,
        renderWhitespace: 'selection',
        smoothScrolling: true,
        padding: { top: 8, bottom: 8 },
      }}
    />
  );
}
