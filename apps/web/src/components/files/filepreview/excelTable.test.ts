// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderWorksheetTable, MAX_PREVIEW_ROWS, type WorksheetLike } from './excelTable';

function fakeSheet(rows: string[][], rowCount = rows.length): WorksheetLike {
  return {
    rowCount,
    columnCount: Math.max(...rows.map((r) => r.length)),
    eachRow: (_o, cb) =>
      rows.forEach((r, i) => cb({ eachCell: (_p, c) => r.forEach((text, j) => c({ text }, j + 1)) }, i + 1)),
  };
}

describe('renderWorksheetTable', () => {
  it('按行列渲染单元格文本', () => {
    const t = renderWorksheetTable(
      fakeSheet([
        ['a', 'b'],
        ['c', 'd'],
      ])
    );
    expect(t.querySelectorAll('tr')).toHaveLength(2);
    expect(t.querySelectorAll('td')[3]?.textContent).toBe('d');
  });

  it('单元格里的 HTML 不会被解析（textContent 渲染）', () => {
    const t = renderWorksheetTable(fakeSheet([['<img src=x onerror=alert(1)>']]));
    expect(t.querySelector('img')).toBeNull();
    expect(t.textContent).toContain('<img');
  });

  it('超过行数上限时追加截断提示', () => {
    const t = renderWorksheetTable(fakeSheet([['x']], MAX_PREVIEW_ROWS + 1));
    expect(t.textContent).toContain('仅预览前');
  });
});
