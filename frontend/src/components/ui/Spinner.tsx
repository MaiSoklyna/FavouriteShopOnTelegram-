interface SpinnerProps {
  size?: number;
  color?: string;
}

export function Spinner({ size = 32, color = "var(--accent)" }: SpinnerProps) {
  return (
    <>
      <div
        style={{
          width: size,
          height: size,
          border: `3px solid var(--border)`,
          borderTopColor: color,
          borderRadius: "50%",
          animation: "spin 0.6s linear infinite",
        }}
      />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}

export function FullPageSpinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <Spinner />
    </div>
  );
}
