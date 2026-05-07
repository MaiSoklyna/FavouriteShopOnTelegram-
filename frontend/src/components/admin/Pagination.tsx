"use client";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1);

  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 16 }}>
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        style={{
          padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: "transparent", border: "1px solid var(--border)",
          color: "var(--text)", cursor: page === 1 ? "not-allowed" : "pointer",
          opacity: page === 1 ? 0.4 : 1,
        }}
      >
        Prev
      </button>
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          style={{
            padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: p === page ? 700 : 400,
            background: p === page ? "var(--accent)" : "transparent",
            color: p === page ? "var(--bg)" : "var(--text)",
            border: p === page ? "none" : "1px solid var(--border)",
            cursor: "pointer",
          }}
        >
          {p}
        </button>
      ))}
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        style={{
          padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: "transparent", border: "1px solid var(--border)",
          color: "var(--text)", cursor: page === totalPages ? "not-allowed" : "pointer",
          opacity: page === totalPages ? 0.4 : 1,
        }}
      >
        Next
      </button>
    </div>
  );
}
