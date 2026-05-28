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

  // Theme registration happens once.
  useEffect(() => {
    monaco.editor.defineTheme('argus-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0a0a0a',
      },
    });
  }, []);

  // Imperatively reveal line when revealLine prop changes (e.g. from search results).
  useEffect(() => {
    if (!revealLine || !editorRef.current) return;
    editorRef.current.revealLineInCenter(revealLine);
    editorRef.current.setPosition({ lineNumber: revealLine, column: 1 });
  }, [revealLine]);

  return (
    <Editor
      value={value}
      language={language}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor, monacoInstance) => {
        editorRef.current = editor;
        if (onSaveShortcut) {
          editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
            onSaveShortcut();
          });
        }
        if (revealLine) {
          editor.revealLineInCenter(revealLine);
          editor.setPosition({ lineNumber: revealLine, column: 1 });
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
