// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, webUtils } = require('electron') as typeof import('electron');

// Map filename → absolute path, populated on each drop event.
// Preload runs in the privileged context where Electron exposes file.path.
const pathMap = new Map<string, string>();

document.addEventListener(
  'drop',
  (e) => {
    pathMap.clear();
    if (!e.dataTransfer?.files) return;
    for (const file of Array.from(e.dataTransfer.files)) {
      const fullPath = webUtils.getPathForFile(file);
      if (fullPath) pathMap.set(file.name, fullPath);
    }
  },
  { capture: true },
);

contextBridge.exposeInMainWorld('electronFiles', {
  getPath: (name: string): string | undefined => pathMap.get(name),
});
