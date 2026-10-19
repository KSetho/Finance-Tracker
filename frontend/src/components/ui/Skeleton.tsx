type Props = { label?: string; lines?: number };

/** Loading placeholder: announced once to assistive tech, the blocks themselves are hidden. */
export function Skeleton({ label = "Loading", lines = 3 }: Props) {
  return (
    <div role="status" aria-label={label} className="skeleton">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} aria-hidden="true" className="skeleton-line" />
      ))}
    </div>
  );
}
