import {
  AlertTriangle, Check, CheckCircle2, CircleX, ExternalLink, HelpCircle, Info,
  MoreHorizontal, MoreVertical, RefreshCw, RotateCcw, SquareTerminal, Trash2, X,
  type LucideIcon,
} from 'lucide-react';

/**
 * One glyph per concept (plan 005, Unit 9). Reach for these instead of picking
 * a lucide icon by eye; `iconSizing.test.ts` bans the look-alikes
 * (TriangleAlert, AlertCircle, AlertOctagon, CheckCircle, CircleCheck,
 * Ellipsis, Terminal, MessageCircleQuestion, and Loader2 outside <Spinner>).
 * Loading has no entry: render <Spinner>.
 */
export const ICON_CONCEPTS = Object.freeze({
  warning: AlertTriangle,
  error: CircleX,
  /** A finished state (a step, a check). */
  success: CheckCircle2,
  /** An inline confirmation (copied, selected). */
  confirm: Check,
  info: Info,
  /** Overflow menu on desktop. */
  more: MoreHorizontal,
  /** Overflow menu on mobile only. */
  moreMobile: MoreVertical,
  /** Start a process again. */
  restart: RotateCcw,
  /** Fetch data again. */
  refresh: RefreshCw,
  terminal: SquareTerminal,
  help: HelpCircle,
  delete: Trash2,
  close: X,
  external: ExternalLink,
} satisfies Record<string, LucideIcon>);

export type IconConcept = keyof typeof ICON_CONCEPTS;
