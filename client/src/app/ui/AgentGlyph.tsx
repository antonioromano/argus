import type { AgentType } from '@argus/shared';

interface AgentGlyphProps {
  agent: AgentType;
  size?: number;
}

const PALETTE = [
  'var(--dirty)', 'var(--ok)', 'var(--warn)',
  'var(--syn-kw)', 'var(--status-running)', 'var(--danger)',
];

function customMeta(agent: string): { glyph: string; color: string } {
  let hash = 0;
  for (let i = 0; i < agent.length; i++) hash = (hash * 31 + agent.charCodeAt(i)) | 0;
  const color = PALETTE[Math.abs(hash) % PALETTE.length];
  const glyph = (agent.replace(/^custom-/, '').charAt(0) || '?').toUpperCase();
  return { glyph, color };
}

function ClaudeIcon({ size }: { size: number }) {
  const sw = Math.max(1.2, size * 0.1);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <g stroke="var(--agent-claude)" strokeWidth={sw} strokeLinecap="round">
        <line x1="8" y1="8" x2="8" y2="2.5" />
        <line x1="8" y1="8" x2="13.4" y2="6.3" />
        <line x1="8" y1="8" x2="11.2" y2="12.5" />
        <line x1="8" y1="8" x2="4.8" y2="12.5" />
        <line x1="8" y1="8" x2="2.6" y2="6.3" />
      </g>
    </svg>
  );
}

function GeminiIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M8 1.5 C8 1.5 8 7.5 14 8 C8 8.5 8 14.5 8 14.5 C8 14.5 8 8.5 2 8 C8 7.5 8 1.5 8 1.5 Z"
        fill="var(--agent-gemini)"
      />
    </svg>
  );
}

function CodexIcon({ size }: { size: number }) {
  const sw = Math.max(1, size * 0.08);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <polygon
        points="8,1.5 13.2,4.75 13.2,11.25 8,14.5 2.8,11.25 2.8,4.75"
        stroke="var(--agent-codex)"
        strokeWidth={sw}
        fill="none"
      />
      <circle cx="8" cy="8" r="1.5" fill="var(--agent-codex)" />
    </svg>
  );
}

export function AgentGlyph({ agent, size = 18 }: AgentGlyphProps) {
  if (agent === 'claude') return <ClaudeIcon size={size} />;
  if (agent === 'gemini') return <GeminiIcon size={size} />;
  if (agent === 'codex') return <CodexIcon size={size} />;

  const meta = customMeta(agent);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        background: `color-mix(in srgb, ${meta.color} 13%, transparent)`,
        color: meta.color,
        border: `1px solid color-mix(in srgb, ${meta.color} 40%, transparent)`,
        borderRadius: 'var(--r-1)',
        fontFamily: 'var(--font-mono)',
        fontWeight: 'var(--fw-semibold)',
        fontSize: size <= 16 ? 10 : size <= 20 ? 11 : 13,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {meta.glyph}
    </span>
  );
}
