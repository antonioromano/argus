interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  message: string;
  detail?: string;
  buttons: string[];
  defaultId?: number;
  cancelId?: number;
}

interface ElectronDialogBridge {
  showMessageBox(o: MessageBoxOptions): Promise<{ response: number }>;
}

declare global {
  interface Window {
    electronDialog?: ElectronDialogBridge;
  }
}

/** Shows a native macOS dialog via Electron's preload IPC bridge. */
export async function showNativeMessageBox(opts: MessageBoxOptions): Promise<number> {
  if (!window.electronDialog) {
    throw new Error('electronDialog bridge is not available — Argus must run inside Electron.');
  }
  const result = await window.electronDialog.showMessageBox(opts);
  return result.response;
}
