export function Switch({ on }: { on: boolean }) {
  return (
    <span
      style={{
        width: 42,
        height: 24,
        borderRadius: 'var(--r-pill)',
        background: on ? 'var(--accent)' : 'var(--line-3)',
        position: 'relative',
        flexShrink: 0,
        transition: 'background var(--dur-fast)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--bg-0)',
          top: 3,
          left: on ? 21 : 3,
          transition: 'left var(--dur-fast) var(--ease-out)',
        }}
      />
    </span>
  );
}
