/**
 * Scrollback lines every terminal keeps. Duplicated in
 * electron/src/nativeTerminal/constants.ts for the native engine (Electron
 * main cannot import renderer code); check:deps keeps the two in sync.
 */
export const TERMINAL_SCROLLBACK = 5000;
