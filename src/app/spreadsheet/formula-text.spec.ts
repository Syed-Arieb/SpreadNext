import { describe, expect, it } from 'vitest';
import { normalizeFormula } from './formula-text';

describe('normalizeFormula', () => {
  it('closes missing parentheses', () => {
    expect(normalizeFormula('=SUM(A1:B4')).toBe('=SUM(A1:B4)');
    expect(normalizeFormula('=SUM((A1+B1)')).toBe('=SUM((A1+B1))');
    expect(normalizeFormula('=IF(A1>0,"yes"')).toBe('=IF(A1>0,"yes")');
  });

  it('removes extra parentheses', () => {
    expect(normalizeFormula('=SUM(A1:B4))')).toBe('=SUM(A1:B4)');
    expect(normalizeFormula('=SUM(A1:B4)))')).toBe('=SUM(A1:B4)');
  });

  it('closes strings', () => {
    expect(normalizeFormula('="hello')).toBe('="hello"');
    expect(normalizeFormula('=SUM("a)b"')).toBe('=SUM("a)b")');
  });

  it('removes trailing separators', () => {
    expect(normalizeFormula('=SUM(A1,)')).toBe('=SUM(A1)');
    expect(normalizeFormula('=A1+')).toBe('=A1');
    expect(normalizeFormula('=A1:')).toBe('=A1');
    expect(normalizeFormula('=A1 + ')).toBe('=A1');
  });

  it('keeps complete formulas and plain text unchanged', () => {
    expect(normalizeFormula('=SUM(A1:B4)')).toBe('=SUM(A1:B4)');
    expect(normalizeFormula('=SUM(A1:B4) ')).toBe('=SUM(A1:B4)');
    expect(normalizeFormula('hello')).toBe('hello');
  });
});
