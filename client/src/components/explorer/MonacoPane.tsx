import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';

// Use locally-bundled Monaco rather than the default CDN loader (works offline / in Electron).
loader.config({ monaco });

interface MonacoPaneProps {
  value: string;
  onChange: (next: string) => void;
  language: string;
  theme: 'dark' | 'light';
  readOnly?: boolean;
  onSaveShortcut?: () => void;
  revealLine?: number;
}

export function MonacoPane({ value, onChange, language, theme, readOnly, onSaveShortcut, revealLine }: MonacoPaneProps) {
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

  // Imperatively reveal + highlight line when revealLine prop changes (e.g. from search results).
  useEffect(() => {
    if (!revealLine || !editorRef.current) return;
    revealAndHighlight(editorRef.current, revealLine);
  }, [revealLine]);

  return (
    <Editor
      value={value}
      language={language}
      theme={theme === 'dark' ? 'argus-dark' : 'vs'}
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor, monacoInstance) => {
        editorRef.current = editor;
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
