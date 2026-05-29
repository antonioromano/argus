import { useState } from 'react';

interface ResizeDividerProps {
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  orientation?: 'vertical' | 'horizontal';
}

export function ResizeDivider({ isDragging, onMouseDown, orientation = 'vertical' }: ResizeDividerProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isActive = isDragging || isHovered;
  const baseStyle: React.CSSProperties = {
    flexShrink: 0,
    background: isActive ? 'var(--accent-edge)' : 'var(--line-2)',
    transition: isDragging ? 'none' : 'background var(--dur-fast) var(--ease-std)',
    userSelect: 'none',
  };
  if (orientation === 'vertical') {
    return (
      <div
        onMouseDown={onMouseDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ ...baseStyle, width: 3, cursor: 'col-resize' }}
      />
    );
  }
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ ...baseStyle, height: 3, cursor: 'row-resize' }}
    />
  );
}
