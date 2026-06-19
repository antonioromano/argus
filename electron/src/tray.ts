import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { showWindow, setStopAllOnQuit } from './window.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;

export function createTray(): Tray {
  // The trayTemplate@2x.png asset is in electron/assets/ — one level up from dist/
  const iconPath = path.join(__dirname, '..', 'assets', 'trayTemplate@2x.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  // '(dev)' suffix distinguishes the unpackaged dev instance from the installed app.
  tray.setToolTip(app.isPackaged ? 'Argus' : 'Argus (dev)');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Argus',
      click: showWindow,
    },
    { type: 'separator' },
    {
      label: 'Quit (Keep Sessions Running)',
      click: () => {
        app.quit();
      },
    },
    {
      label: 'Quit & Stop All Sessions',
      click: () => {
        setStopAllOnQuit(true);
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', showWindow);

  return tray;
}
