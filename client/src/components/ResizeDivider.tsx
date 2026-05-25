import { useState } from 'react';

interface ResizeDividerProps {
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  orientation?: 'vertical' | 'horizontal';
}

export function ResizeDivider({ isDragging, onMouseDown, orientation = 'vertical' }: ResizeDividerProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isActive = isDragging || isHovered;

  if (orientation === 'vertical') {
    return (
      <div
        onMouseDown={onMouseDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width: '3px',
          cursor: 'col-resize',
          flexShrink: 0,
          background: isActive ? 'var(--color-accent)' : 'var(--color-border-ghost)',
          transition: isDragging ? 'none' : 'background 0.15s',
          userSelect: 'none',
        }}
      />
    );
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        height: '3px',
        cursor: 'row-resize',
        flexShrink: 0,
        background: isActive ? 'var(--color-accent)' : 'var(--color-border-ghost)',
        transition: isDragging ? 'none' : 'background 0.15s',
        userSelect: 'none',
      }}
    />
  );
}
