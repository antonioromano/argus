import { Gauge, GitBranch, GitPullRequest } from 'lucide-react';
import type { InspectorSectionDef } from './types.js';
import { UsageBody, UsageGlance } from './UsageSection.js';
import { GitBody, GitGlance } from './GitSection.js';
import { GitHubBody, GitHubGlance } from './GitHubSection.js';

/**
 * The Session Inspector's sections, top to bottom. Add a section by adding an
 * entry: its id is what AppConfig.inspectorCollapsed remembers.
 */
export const INSPECTOR_SECTIONS: readonly InspectorSectionDef[] = [
  { id: 'usage', title: 'Usage', icon: Gauge, Glance: UsageGlance, Body: UsageBody },
  { id: 'git', title: 'Git', icon: GitBranch, Glance: GitGlance, Body: GitBody },
  { id: 'github', title: 'GitHub', icon: GitPullRequest, Glance: GitHubGlance, Body: GitHubBody },
];
