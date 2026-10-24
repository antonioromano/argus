// Mirrors of the Session Inspector bounds in @argus/shared. Server code may only
// `import type` from shared (see CLAUDE.md), so the values live here too;
// scripts/check-dep-sync.mjs keeps the two copies equal.

/** Session Inspector column width bounds (px). */
export const INSPECTOR_WIDTH_MIN = 220;
export const INSPECTOR_WIDTH_MAX = 560;
/** Inspector section ids are short slugs; anything else in `inspectorCollapsed` is rejected. */
export const INSPECTOR_SECTION_ID = /^[a-z][a-z0-9-]{0,31}$/;
export const INSPECTOR_SECTIONS_MAX = 32;
