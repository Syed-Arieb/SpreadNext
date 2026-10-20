import { exportFileName } from './export-file-name';

describe('exportFileName', () => {
  it('uses the sheet title and extension', () => {
    expect(exportFileName('Budget 2026', 'csv')).toBe('Budget 2026.csv');
  });

  it('replaces characters that are invalid in file names', () => {
    expect(exportFileName('Q1/Q2: Plan?', 'xlsx')).toBe('Q1-Q2- Plan-.xlsx');
  });

  it('falls back when the title is empty or only dots', () => {
    expect(exportFileName('  ', 'csv')).toBe('Untitled spreadsheet.csv');
    expect(exportFileName('...', 'csv')).toBe('Untitled spreadsheet.csv');
  });

  it('avoids Windows reserved names', () => {
    expect(exportFileName('con', 'xlsx')).toBe('_con.xlsx');
  });

  it('limits long titles', () => {
    expect(exportFileName('a'.repeat(200), 'csv')).toHaveLength(124);
  });
});
