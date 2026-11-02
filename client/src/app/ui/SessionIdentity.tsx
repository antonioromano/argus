import type { SessionInfo } from '@argus/shared';

/**
 * A session's identity: an optional emoji before its name and an optional
 * colour drawn as a 3px leading edge bar. The edge is an inset box-shadow
 * (index.css `[data-identity-edge]`), never a border, so it cannot reflow a
 * row; groups keep their dot and status its own dot, so the three never read
 * as one another.
 */

/** The emoji in a fixed-width slot: a wide ZWJ sequence or a tofu box can
 *  never push the name sideways. Renders nothing without an emoji. */
export function SessionIdentity({ session, size }: { session: Pick<SessionInfo, 'emoji'>; size?: number }) {
  if (!session.emoji) return null;
  return (
    <span
      aria-hidden
      className="argus-identity-emoji"
      data-testid="session-identity-emoji"
      style={size ? { fontSize: size } : undefined}
    >
      {session.emoji}
    </span>
  );
}
