import { trimToUsedRange, usedRange } from './sheet-range';

describe('sheet range', () => {
  it('finds the used range of a sheet', () => {
    expect(usedRange([
      ['a', '', 'c'],
      ['', '', ''],
      ['', '', '']
    ])).toEqual({ rows: 1, columns: 3 });
  });

  it('reports an empty range for an empty sheet', () => {
    expect(usedRange([
      ['', ''],
      ['', '']
    ])).toEqual({ rows: 0, columns: 0 });
  });

  it('keeps empty cells inside the used range', () => {
    expect(trimToUsedRange([
      ['a', '', 'c'],
      ['', '', ''],
      ['', '', '']
    ])).toEqual([['a', '', 'c']]);
  });

  it('keeps leading empty cells', () => {
    expect(trimToUsedRange([
      ['', '', 'c'],
      ['', '', '']
    ])).toEqual([['', '', 'c']]);
  });

  it('trims trailing empty rows and columns', () => {
    expect(trimToUsedRange([
      ['a', 'b', '', ''],
      ['', '', '', '']
    ])).toEqual([['a', 'b']]);
  });

  it('trims to nothing when every cell is empty', () => {
    expect(trimToUsedRange([
      ['', ''],
      ['', '']
    ])).toEqual([]);
  });
});
