import clsx from "clsx";

// A small read-only table for panels on detail pages (lists use DataTable).

export type SimpleColumn<T> = { header: string; cell: (row: T) => React.ReactNode; numeric?: boolean };

export function SimpleTable<T extends { id: string }>({ columns, rows, empty }: { columns: SimpleColumn<T>[]; rows: T[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="-mx-4 -my-2 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th key={c.header} scope="col" className={clsx("px-4 py-2 text-xs font-normal text-muted", c.numeric ? "text-right" : "text-left")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0 hover:bg-[#f7f9fb]">
              {columns.map((c) => (
                <td key={c.header} className={clsx("px-4 py-2", c.numeric && "text-right tabular-nums")}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
