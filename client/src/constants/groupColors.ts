// Theme-aware palette for session groups. `key` is what we persist in
// SessionGroup.color; resolve to a concrete hex at render time with the
// current theme so colors read well on both warm-black and paper surfaces.

export interface GroupColor {
  key: string;
  label: string;
  dark: string;
  light: string;
}

export const GROUP_COLORS: GroupColor[] = [
  { key: 'blue',   label: 'Blue',   dark: '#7DD3FC', light: '#1668B3' },
  { key: 'green',  label: 'Green',  dark: '#7CFFB2', light: '#0E7F4D' },
  { key: 'purple', label: 'Purple', dark: '#C5B4FC', light: '#6E40B8' },
  { key: 'amber',  label: 'Amber',  dark: '#FFB454', light: '#B26A00' },
  { key: 'pink',   label: 'Pink',   dark: '#FF8FB0', light: '#B83A63' },
  { key: 'teal',   label: 'Teal',   dark: '#5FE3D0', light: '#0E7F76' },
];

export const DEFAULT_GROUP_COLOR = GROUP_COLORS[0].key;

export function resolveGroupColor(key: string, isDark: boolean): string {
  const c = GROUP_COLORS.find((g) => g.key === key) ?? GROUP_COLORS[0];
  return isDark ? c.dark : c.light;
}
