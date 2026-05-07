"use client";

import type { ReactNode } from "react";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  width?: number | string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyIcon?: string;
  emptyTitle?: string;
  emptyAction?: string;
  onEmptyAction?: () => void;
  keyField?: string;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  loading,
  emptyIcon = "📭",
  emptyTitle = "No data found",
  emptyAction,
  onEmptyAction,
  keyField = "id",
}: DataTableProps<T>) {
  if (loading) return <TableSkeleton rows={5} />;

  if (data.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} action={emptyAction} onAction={onEmptyAction} />;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={item[keyField]}>
              {columns.map((col) => (
                <td key={col.key}>{col.render(item)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
