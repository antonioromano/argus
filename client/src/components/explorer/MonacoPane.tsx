import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect } from 'react';

// Use locally-bundled Monaco rather than the default CDN loader (works offline / in Electron).
loader.config({ monaco });

interface MonacoPaneProps {
  value: string;
  onChange: (next: string) => void;
  language: string;
  theme: 'dark' | 'light';
  readOnly?: boolean;
  onSaveShortcut?: () => void;
}

export function MonacoPane({ value, onChange, language, theme, readOnly, onSaveShortcut }: MonacoPaneProps) {
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

  return (
    <Editor
      value={value}
      language={language}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor, monacoInstance) => {
        if (onSaveShortcut) {
          editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
            onSaveShortcut();
          });
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
