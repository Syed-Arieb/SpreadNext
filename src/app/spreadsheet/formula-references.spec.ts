import { describe, expect, it } from 'vitest';
import { parseFormulaReferences } from './formula-references';

describe('parseFormulaReferences', () => {
  it('finds cell references in order', () => {
    expect(parseFormulaReferences('=A1+A2')).toEqual([
      { top: 0, bottom: 0, left: 0, right: 0, colorIndex: 0 },
      { top: 1, bottom: 1, left: 0, right: 0, colorIndex: 1 }
    ]);
  });

  it('finds ranges', () => {
    expect(parseFormulaReferences('=SUM(A1:B4)')).toEqual([
      { top: 0, bottom: 3, left: 0, right: 1, colorIndex: 0 }
    ]);
    expect(parseFormulaReferences('=SUM(A1 : B4)')).toEqual([
      { top: 0, bottom: 3, left: 0, right: 1, colorIndex: 0 }
    ]);
  });

  it('supports absolute references', () => {
    expect(parseFormulaReferences('=$A$1+$B2')).toEqual([
      { top: 0, bottom: 0, left: 0, right: 0, colorIndex: 0 },
      { top: 1, bottom: 1, left: 1, right: 1, colorIndex: 1 }
    ]);
  });

  it('converts multi-letter columns', () => {
    expect(parseFormulaReferences('=AA1')).toEqual([
      { top: 0, bottom: 0, left: 26, right: 26, colorIndex: 0 }
    ]);
  });

  it('ignores text and function names', () => {
    expect(parseFormulaReferences('=IF(A1>0,"A2",B3)')).toEqual([
      { top: 0, bottom: 0, left: 0, right: 0, colorIndex: 0 },
      { top: 2, bottom: 2, left: 1, right: 1, colorIndex: 1 }
    ]);
    expect(parseFormulaReferences('=LOG10(A1)')).toEqual([
      { top: 0, bottom: 0, left: 0, right: 0, colorIndex: 0 }
    ]);
  });

  it('removes duplicate references', () => {
    expect(parseFormulaReferences('=A1+A1')).toEqual([
      { top: 0, bottom: 0, left: 0, right: 0, colorIndex: 0 }
    ]);
  });

  it('ignores invalid references and plain text', () => {
    expect(parseFormulaReferences('=A0')).toEqual([]);
    expect(parseFormulaReferences('A1')).toEqual([]);
  });
});
