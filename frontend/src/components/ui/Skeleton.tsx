interface SkeletonProps {
  height?: number | string;
  width?: number | string;
  radius?: number;
  count?: number;
  gap?: number;
}

export function Skeleton({ height = 60, width = "100%", radius = 12, count = 1, gap = 8 }: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            height,
            width,
            borderRadius: radius,
            background: "var(--bg-secondary)",
            marginBottom: i < count - 1 ? gap : 0,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 16 }}>
      <Skeleton count={rows} height={48} />
    </div>
  );
}
