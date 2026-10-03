// Hard rule 2 (CLAUDE.md): no cost, margin, password or token field may leave the ERP boundary.
// The erp_read views already exclude these columns; this is a second check on every row the CRM reads,
// so a future view change cannot leak one into the UI, logs or prompts sent to Claude.

const FORBIDDEN_COLUMN = /cost|margin|password|token|secret|price_tier/i;

export class ErpBoundaryError extends Error {
  constructor(column: string) {
    super(`ERP read returned a forbidden column "${column}". Fix the erp_read view or the query.`);
    this.name = "ErpBoundaryError";
  }
}

export function isForbiddenErpColumn(name: string): boolean {
  return FORBIDDEN_COLUMN.test(name);
}

export function assertSafeErpColumns(columns: Iterable<string>): void {
  for (const c of columns) {
    if (isForbiddenErpColumn(c)) throw new ErpBoundaryError(c);
  }
}
