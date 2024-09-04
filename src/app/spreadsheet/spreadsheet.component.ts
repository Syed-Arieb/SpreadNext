import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-spreadsheet',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './spreadsheet.component.html',
  styleUrl: './spreadsheet.component.css'
})
export class SpreadsheetComponent {
  @Input() rows: number = 4;
  @Input() columns: number = 4;
  @Input() columnTitles: string[] = Array.from({length: this.columns}, (_, i) => `Column #${i+1}`);
  @Output() cellChange = new EventEmitter<{ row: number, column: number, value: string }>();
  cellData: string[][] = [];

  rowIndices: number[] = [];
  columnIndices: number[] = [];

  constructor() {
    this.initCellData();
  }

  private initCellData() {
    for (let i = 0; i < this.rows; i++) {
      this.cellData[i] = [];
      for (let j = 0; j < this.columns; j++) {
        this.cellData[i][j] = '';
      }
    }
  }

  getCellData(row: number, column: number): string {
    return this.cellData[row][column];
  }

  onCellChange(value: string, row: number, column: number) {
    this.cellData[row][column] = value;
    this.cellChange.emit({ row, column, value });
    console.log(`Cell at row ${row}, column ${column} changed to ${value}`);
  }

  ngOnInit() {
    this.columnTitles = this.columnTitles.length
      ? this.columnTitles
      : Array.from({ length: this.columns }, (_, i) => `Column #${i + 1}`);

    this.rowIndices = Array.from({ length: this.rows }, (_, i) => i);
    this.columnIndices = Array.from({ length: this.columns }, (_, i) => i);
  }

  addRow() {
    this.rows++;
    this.rowIndices = Array.from({ length: this.rows }, (_, i) => i);
    this.cellData.push([]); // Add a new empty row to cellData
    for (let j = 0; j < this.columns; j++) {
      this.cellData[this.rows - 1][j] = ''; // Initialize each cell in the new row
    }
    console.table(this.cellData);
  }

  addColumn() {
    this.columns++;
    this.columnTitles = this.columnTitles.length
      ? [...this.columnTitles, `Column #${this.columns}`]
      : Array.from({ length: this.columns }, (_, i) => `Column #${i + 1}`);
    this.columnIndices = Array.from({ length: this.columns }, (_, i) => i);
    for (let i = 0; i < this.rows; i++) {
      this.cellData[i].push(''); // Add a new empty cell to each row
    }
  }

}
