import { Loader2 } from 'lucide-react';
import { Icon } from './Icon.js';

interface SpinnerProps {
  size?: number;
  color?: string;
}

export function Spinner({ size = 14, color = 'currentColor' }: SpinnerProps) {
  return (
    <span style={{ display: 'inline-flex', animation: 'argus-spin 0.9s linear infinite', color }}>
      <Icon icon={Loader2} size={size} strokeWidth={2} />
    </span>
  );
}
