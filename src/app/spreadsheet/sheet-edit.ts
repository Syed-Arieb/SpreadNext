export function insertRow<T>(rows: T[][], index: number, create: () => T[]): void {
  rows.splice(index, 0, create());
}

export function removeRow<T>(rows: T[][], index: number): void {
  rows.splice(index, 1);
}

export function insertColumn<T>(rows: T[][], index: number, create: () => T): void {
  for (const row of rows) {
    row.splice(index, 0, create());
  }
}

export function removeColumn<T>(rows: T[][], index: number): void {
  for (const row of rows) {
    row.splice(index, 1);
  }
}
