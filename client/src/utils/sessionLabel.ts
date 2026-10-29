export function shellLabel(s: { name?: string; folderPath: string }): string {
  return s.name || s.folderPath.split('/').filter(Boolean).pop() || s.folderPath;
}

/** The label with the session's identity emoji in front, for plain-text
 *  surfaces (notifications, window titles) that cannot render the edge bar. */
export function displayLabel(s: { name?: string; folderPath: string; emoji?: string }): string {
  const label = shellLabel(s);
  return s.emoji ? `${s.emoji} ${label}` : label;
}
