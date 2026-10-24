import type { ReactNode } from 'react';

/** A label / value line inside an inspector section. */
export function InspectorRow({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="argus-inspector-row" title={title}>
      <span className="argus-inspector-label">{label}</span>
      <span className="argus-inspector-value">{children}</span>
    </div>
  );
}

/** Muted one-liner for a section with nothing to show. */
export function InspectorEmpty({ children }: { children: ReactNode }) {
  return <div className="argus-inspector-empty">{children}</div>;
}
