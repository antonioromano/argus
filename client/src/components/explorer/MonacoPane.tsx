import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { registerSymbolProviders, addSymbolEditorActions, symbolNavContext } from './registerSymbolProviders.js';
import { useFontSettings } from '../../context/font-settings-context.js';

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

// How long the .argus-line-flash animation runs (keep in sync with index.css).
const FLASH_MS = 1400;
// Minimum editor viewport height (px) before revealLineInCenter can actually
// scroll. A freshly-mounted tab briefly reports a few px mid-layout; revealing
// then is a no-op, so we wait until the editor is at least this tall.
const MIN_REVEAL_HEIGHT = 80;

export function MonacoPane({ value, onChange, language, theme, readOnly, onSaveShortcut, path, revealLine, revealNonce }: MonacoPaneProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { codeFontSize } = useFontSettings();
  const decoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  // Latest reveal request + the last one we actually applied, so a request that
  // arrives before the editor is mounted/laid out still lands (and never twice).
  const pendingRevealRef = useRef<{ line: number; nonce: number } | null>(null);
  const appliedNonceRef = useRef<number | null>(null);
  // A one-shot onDidLayoutChange listener waiting for the editor to gain height,
  // and the timer that clears the flash decoration — both disposed on unmount.
  const layoutWaitRef = useRef<monaco.IDisposable | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reveal + position the cursor on a line and flash-highlight the whole row,
  // then clear the decoration once the flash settles so no tint lingers.
  const revealAndHighlight = (editor: monaco.editor.IStandaloneCodeEditor, line: number) => {
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    decoRef.current?.clear();
    decoRef.current = editor.createDecorationsCollection([
      { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'argus-line-flash' } },
    ]);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      decoRef.current?.clear();
      flashTimerRef.current = null;
    }, FLASH_MS);
  };

  // Apply the pending reveal once the editor exists AND is actually laid out.
  // A freshly-mounted editor in a flex container ramps its height up over a few
  // layout passes (0 → a few px → final) before automaticLayout's ResizeObserver
  // settles. revealLineInCenter against a near-zero-height viewport silently
  // fails to scroll, so a bare `height > 0` check fires too early (a 5px sliver
  // passes it) and the line never comes into view. We require a usable height,
  // and otherwise wait for the onDidLayoutChange that reaches it. Nonce-guarded.
  const drainReveal = () => {
    const editor = editorRef.current;
    const pending = pendingRevealRef.current;
    if (!editor || !pending) return;
    if (pending.nonce === appliedNonceRef.current) return;
    // Claim this nonce up front so re-renders/onMount don't arm duplicate
    // listeners; a newer nonce still supersedes (it won't equal applied).
    appliedNonceRef.current = pending.nonce;
    const line = pending.line;
    layoutWaitRef.current?.dispose();
    layoutWaitRef.current = null;

    if (editor.getLayoutInfo().height >= MIN_REVEAL_HEIGHT) {
      revealAndHighlight(editor, line);
      return;
    }
    layoutWaitRef.current = editor.onDidLayoutChange(() => {
      if (editor.getLayoutInfo().height < MIN_REVEAL_HEIGHT) return;
      layoutWaitRef.current?.dispose();
      layoutWaitRef.current = null;
      revealAndHighlight(editor, line);
    });
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

  // Record the reveal request and drain it. revealNonce covers jumps to the same
  // line (search re-hit, cross-file open to an identical line number) that a bare
  // revealLine dependency would swallow. drainReveal handles the case where the
  // editor isn't mounted/laid out yet (cross-file open of a not-yet-loaded file).
  useEffect(() => {
    if (!revealLine) return;
    pendingRevealRef.current = { line: revealLine, nonce: revealNonce ?? revealLine };
    drainReveal();
    // drainReveal reads only refs/props through its closure; re-run is keyed on
    // the reveal request itself, not on the (per-render) function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealLine, revealNonce]);

  // Live-apply the code font size to the mounted editor.
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: codeFontSize });
  }, [codeFontSize]);

  // Dispose the pending layout listener + flash timer + decoration on unmount so
  // no callback fires against a disposed editor.
  useEffect(() => {
    return () => {
      layoutWaitRef.current?.dispose();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      decoRef.current?.clear();
    };
  }, []);

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
          pendingRevealRef.current = { line: revealLine, nonce: revealNonce ?? revealLine };
        }
        drainReveal();
      }}
      options={{
        readOnly,
        fontFamily: 'var(--font-mono), Menlo, monospace',
        fontSize: codeFontSize,
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
