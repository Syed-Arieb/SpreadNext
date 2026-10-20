import {
  insertColumn,
  insertRow,
  removeColumn,
  removeRow
} from './sheet-edit';

describe('sheet edit', () => {
  it('inserts a row at the given index', () => {
    const rows = [['a'], ['c']];
    insertRow(rows, 1, () => ['b']);

    expect(rows).toEqual([['a'], ['b'], ['c']]);
  });

  it('removes the row at the given index', () => {
    const rows = [['a'], ['b'], ['c']];
    removeRow(rows, 1);

    expect(rows).toEqual([['a'], ['c']]);
  });

  it('inserts a column at the given index', () => {
    const rows = [['a', 'c'], ['d', 'f']];
    insertColumn(rows, 1, () => 'x');

    expect(rows).toEqual([['a', 'x', 'c'], ['d', 'x', 'f']]);
  });

  it('removes the column at the given index', () => {
    const rows = [['a', 'b', 'c'], ['d', 'e', 'f']];
    removeColumn(rows, 1);

    expect(rows).toEqual([['a', 'c'], ['d', 'f']]);
  });

  it('keeps the other rows untouched', () => {
    const rows = [['a', 'b'], ['c', 'd'], ['e', 'f']];
    removeColumn(rows, 0);

    expect(rows).toEqual([['b'], ['d'], ['f']]);
  });
});
