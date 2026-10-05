import type { Row, TableColumn } from "./types";

// "Export to Excel": the visible columns of the filtered, sorted rows. ExcelJS is loaded only when clicked.

function excelValue(col: TableColumn, row: Row): string | number | Date | null {
  const v = row[col.key];
  if (v === null || v === undefined || v === "") return null;
  switch (col.kind) {
    case "number":
    case "money":
      return Number(v);
    case "date": {
      const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    }
    case "datetime":
      return new Date(String(v));
    case "boolean":
      return v ? "Yes" : "";
    default:
      return String(v);
  }
}

/** The .xlsx file contents (separate from the download so it can be tested). */
export async function buildWorkbook(sheetName: string, columns: TableColumn[], rows: Row[]) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.max(12, Math.min(40, c.header.length + 4)),
    style:
      c.kind === "money"
        ? { numFmt: "#,##0.00" }
        : c.kind === "date"
          ? { numFmt: "dd/mm/yyyy" }
          : c.kind === "datetime"
            ? { numFmt: "dd/mm/yyyy hh:mm" }
            : {},
  }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c.key, excelValue(c, r)])));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return wb.xlsx.writeBuffer();
}

export async function exportToExcel(fileStem: string, columns: TableColumn[], rows: Row[]) {
  const buffer = await buildWorkbook(fileStem, columns, rows);
  const url = URL.createObjectURL(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileStem}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
