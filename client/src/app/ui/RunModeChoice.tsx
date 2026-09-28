import type { RunMode } from '@argus/shared';
import { Segmented } from '../../components/primitives/index.js';

const OPTIONS: readonly { value: RunMode; label: string; title: string }[] = [
  { value: 'persistent', label: 'Persistent', title: 'Survives Argus restarts (argusd/tmux)' },
  { value: 'direct', label: 'Direct', title: 'Like ⌘T — stops when Argus quits' },
];

/** Where the agent process lives (spec D1). Fixed once the session exists. */
export function RunModeChoice({ value, onChange }: { value: RunMode; onChange: (v: RunMode) => void }) {
  return <Segmented label="Run mode" value={value} options={OPTIONS} onChange={onChange} />;
}
