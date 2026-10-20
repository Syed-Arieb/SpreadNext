export interface UsedRange {
  rows: number;
  columns: number;
}

export function usedRange(values: string[][]): UsedRange {
  let rows = 0;
  let columns = 0;

  for (let row = 0; row < values.length; row += 1) {
    const cells = values[row] ?? [];

    for (let column = 0; column < cells.length; column += 1) {
      if (cells[column] !== '') {
        rows = Math.max(rows, row + 1);
        columns = Math.max(columns, column + 1);
      }
    }
  }

  return { rows, columns };
}

export function trimToUsedRange(values: string[][]): string[][] {
  const range = usedRange(values);

  return values
    .slice(0, range.rows)
    .map(row => (row ?? []).slice(0, range.columns));
}
