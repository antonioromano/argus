/**
 * Longest accepted shell display name.
 *
 * Deliberately duplicated from `SESSION_NAME_MAX` in `shared/src/types.ts`
 * instead of imported: the packaged app resolves `@argus/shared` nowhere (the
 * asar ships `shared/dist/` but no `node_modules/@argus/shared`), so a runtime
 * import of that package from server code crashes the app at launch with
 * ERR_MODULE_NOT_FOUND — which is exactly what shipped in v0.22.5. Server code
 * may only ever `import type` from `@argus/shared`.
 *
 * `check:deps` enforces both halves: no value imports of @argus/* in server
 * sources, and this number staying equal to the shared one.
 */
export const SESSION_NAME_MAX = 60;
