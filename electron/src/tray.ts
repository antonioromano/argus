import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { showWindow } from './window.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;

export function createTray(): Tray {
  // The trayTemplate@2x.png asset is in electron/assets/ — one level up from dist/
  const iconPath = path.join(__dirname, '..', 'assets', 'trayTemplate@2x.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip('Argus');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Argus',
      click: showWindow,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', showWindow);

  return tray;
}
