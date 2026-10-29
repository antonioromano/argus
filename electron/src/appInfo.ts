/**
 * What the running app is, for the About sheet and the diagnostics block
 * (plan 002). No electron import: main passes the few facts only it knows.
 */
import { readFileSync } from 'node:fs';
import type { AppEnvironment, AppInfo, BuildStamp } from '@argus/shared';
import { DOCS_URL, LICENSE_URL, RELEASES_URL, REPO_URL } from './helpLinks.js';

/**
 * The stamp scripts/write-build-info.mjs writes into electron/dist at build
 * time. Missing or malformed (a plain `tsc` build) → null, shown as "dev".
 */
export function readBuildStamp(file: string): BuildStamp | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<BuildStamp>;
    if (typeof raw.sha !== 'string' || !/^[0-9a-f]{4,40}$|^unknown$/.test(raw.sha)) return null;
    return {
      sha: raw.sha,
      builtAt: typeof raw.builtAt === 'string' ? raw.builtAt : null,
      dirty: raw.dirty === true,
    };
  } catch {
    return null;
  }
}

export interface AppFacts {
  appVersion: string;
  packaged: boolean;
  macos: string;
  arch: string;
  versions: Partial<Record<'electron' | 'chrome' | 'node', string>>;
  build: BuildStamp | null;
}

export function appEnvironment(f: AppFacts): AppEnvironment {
  return {
    appVersion: f.appVersion,
    build: f.build,
    packaged: f.packaged,
    macos: f.macos,
    arch: f.arch,
    electron: f.versions.electron ?? 'unknown',
    chrome: f.versions.chrome ?? 'unknown',
    node: f.versions.node ?? 'unknown',
  };
}

export function appInfo(f: AppFacts): AppInfo {
  return {
    ...appEnvironment(f),
    links: { repo: REPO_URL, license: LICENSE_URL, releases: RELEASES_URL, docs: DOCS_URL },
  };
}
