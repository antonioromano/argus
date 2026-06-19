// Shared exclusion sets for filesystem read/search and symbol search, so the
// "what we skip" rule can't drift between routes.

export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  '.svg', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.bin', '.dylib', '.so', '.o', '.a', '.dll',
  '.pyc', '.db', '.sqlite', '.sqlite3',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.webm',
]);

export const EXCLUDED_SEARCH_DIRS = new Set([
  'node_modules', '.git', '__pycache__', 'dist', 'build',
  '.next', '.nuxt', '.cache', 'coverage', '.terraform',
]);

export const EXCLUDED_SEARCH_EXTS = new Set(['.map', '.lock', '.log']);
