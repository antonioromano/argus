import fs from 'fs';

/**
 * Where to serve the renderer bundle from.
 *
 * In the packaged app the server runs from app.asar, but client/dist is
 * unpacked next to it (electron-builder `asarUnpack`). Serve the real files in
 * app.asar.unpacked: opening a file *inside* the asar makes Electron copy it to
 * $TMPDIR once and reuse that copy for the life of the process, and macOS
 * purges $TMPDIR files untouched for ~3 days. After that the page 404s until
 * the app restarts.
 *
 * Falls back to the given path (dev, or a build that did not unpack it).
 */
export function resolveClientDist(
  clientDist: string,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const unpacked = clientDist.replace(/\bapp\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
  if (unpacked !== clientDist && exists(unpacked)) return unpacked;
  return clientDist;
}
