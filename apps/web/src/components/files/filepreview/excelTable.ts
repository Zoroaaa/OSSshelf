/**
 * excelTable.ts
 * 把 exceljs 工作表渲染为 <table>（只用 textContent，不拼 HTML，天然免疫单元格内容注入）。
 * 行列设上限，避免超大表格卡死主线程；超限时在表尾追加提示行。
 */

export const MAX_PREVIEW_ROWS = 2000;
export const MAX_PREVIEW_COLS = 50;

export interface WorksheetLike {
  rowCount: number;
  columnCount: number;
  eachRow: (
    opts: { includeEmpty: boolean },
    cb: (
      row: { eachCell: (opts: { includeEmpty: boolean }, cb: (cell: { text: string }, col: number) => void) => void },
      rowNumber: number
    ) => void
  ) => void;
}

export function renderWorksheetTable(sheet: WorksheetLike, doc: Document = document): HTMLTableElement {
  const table = doc.createElement('table');
  table.className = 'w-full border-collapse text-sm';
  const cols = Math.min(sheet.columnCount, MAX_PREVIEW_COLS);

  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber > MAX_PREVIEW_ROWS) return;
    const tr = doc.createElement('tr');
    const cells: string[] = Array.from({ length: cols }, () => '');
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col <= cols) cells[col - 1] = cell.text ?? '';
    });
    for (const text of cells) {
      const td = doc.createElement('td');
      td.className = 'border border-border px-2 py-1 text-left';
      td.textContent = text;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });

  if (sheet.rowCount > MAX_PREVIEW_ROWS || sheet.columnCount > MAX_PREVIEW_COLS) {
    const tr = doc.createElement('tr');
    const td = doc.createElement('td');
    td.colSpan = Math.max(cols, 1);
    td.className = 'px-2 py-2 text-center text-muted-foreground';
    td.textContent = `仅预览前 ${MAX_PREVIEW_ROWS} 行 / ${MAX_PREVIEW_COLS} 列，完整内容请下载查看`;
    tr.appendChild(td);
    table.appendChild(tr);
  }
  return table;
}
