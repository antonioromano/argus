import { History, LayoutTemplate, PanelLeft, PanelRight, Send } from 'lucide-react';
import type { Command } from '../types.js';
import type { CommandContext } from './context.js';

/** The palette's own actions that no menu, shortcut or setting carries. */
export function viewSource(ctx: CommandContext): Command[] {
  return [
    {
      id: 'view:inspector-side',
      title: ctx.inspectorSide === 'left' ? 'Move Session Inspector to the right' : 'Move Session Inspector to the left',
      category: 'View',
      keywords: 'inspector side panel left right usage context git branch github pull request pr',
      icon: ctx.inspectorSide === 'left' ? PanelRight : PanelLeft,
      source: 'view',
      run: ctx.switchInspectorSide,
    },
    {
      id: 'view:broadcast',
      title: 'Broadcast input…',
      category: 'Sessions',
      hint: 'type into several sessions',
      keywords: 'send all many multiple type same text compact',
      icon: Send,
      source: 'view',
      run: ctx.openBroadcast,
    },
    // Beta F10: templates live in Settings → Launchers.
    {
      id: 'view:launch-template',
      title: 'Launch template…',
      category: 'Sessions',
      hint: 'several sessions into a new group',
      keywords: 'template multi session spawn group worktree start',
      icon: LayoutTemplate,
      source: 'view',
      when: ctx.templatesEnabled,
      run: () => ctx.openSettings('launchers'),
    },
    ...ctx.resumable.map((s): Command => ({
      id: `resume:${s.id}`,
      title: `Resume conversation: ${s.name}`,
      category: 'Sessions',
      hint: s.folderPath.split('/').slice(-2).join('/'),
      keywords: 'resume claude continue restart',
      icon: History,
      source: 'view',
      run: () => ctx.resume(s),
    })),
  ];
}
