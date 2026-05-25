import type { ReactNode } from 'react';

interface Segment {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface MacSegmentedControlProps {
  segments: Segment[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  wrap?: boolean;
}

export function MacSegmentedControl({
  segments,
  value,
  onChange,
  disabled = false,
  wrap = false,
}: MacSegmentedControlProps) {
  return (
    <div
      role="group"
      style={{
        display: 'inline-flex',
        flexWrap: wrap ? 'wrap' : 'nowrap',
        gap: 2,
        background: 'var(--color-segment-bg, rgba(0,0,0,0.06))',
        borderRadius: 8,
        padding: 2,
      }}
    >
      {segments.map((seg) => {
        const isSelected = seg.value === value;
        return (
          <button
            key={seg.value}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(seg.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 10px',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)',
              fontWeight: isSelected ? 500 : 400,
              color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              background: isSelected
                ? 'var(--color-segment-selected-bg, #ffffff)'
                : 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
              transition: 'background 0.12s ease, box-shadow 0.12s ease, color 0.12s ease',
              userSelect: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {seg.icon}
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
