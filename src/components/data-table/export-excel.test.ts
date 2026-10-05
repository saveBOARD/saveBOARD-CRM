import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "./export-excel";
import type { TableColumn } from "./types";

describe("buildWorkbook", () => {
  it("writes real numbers and dates, with headers, in column order", async () => {
    const columns: TableColumn[] = [
      { key: "name", header: "Company" },
      { key: "value", header: "Value", kind: "money" },
      { key: "d", header: "Last activity", kind: "date" },
      { key: "s", header: "Samples sent", kind: "boolean" },
    ];
    const buffer = await buildWorkbook("companies", columns, [{ name: "Fulton Hogan", value: "5995.5", d: "2026-09-30", s: true }]);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);
    const ws = wb.getWorksheet("companies")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Company", "Value", "Last activity", "Samples sent"]);
    const row = ws.getRow(2);
    expect(row.getCell(1).value).toBe("Fulton Hogan");
    expect(row.getCell(2).value).toBe(5995.5);
    expect(row.getCell(2).numFmt).toBe("#,##0.00");
    expect((row.getCell(3).value as Date).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(row.getCell(3).numFmt).toBe("dd/mm/yyyy");
    expect(row.getCell(4).value).toBe("Yes");
  });
});
