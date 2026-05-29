export function shellLabel(s: { name?: string; folderPath: string }): string {
  return s.name || s.folderPath.split('/').filter(Boolean).pop() || s.folderPath;
}
