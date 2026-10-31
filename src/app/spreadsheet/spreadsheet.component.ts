import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnDestroy,
  OnInit,
  Output,
  QueryList,
  ViewChild,
  ViewChildren
} from '@angular/core';

import { NgIcon } from '@ng-icons/core';
import {
  BorderLineStyle,
  BorderPreset,
  BorderSide,
  CellBorder,
  DiagonalSide,
  DIAGONAL_SIDES,
  BORDER_SIDES,
  applyBorderPreset,
  borderCss,
  diagonalGradient,
  normalizeCellBorders,
  normalizeColor
} from './cell-borders';
import {
  CellAlign,
  CellStyle,
  DEFAULT_CELL_STYLE,
  clearCellFormatting,
  cloneCellStyle,
  hasCellFormatting
} from './cell-style';
import { exportFileName } from './export-file-name';
import { FormulaEngine } from './formula-engine';
import { FORMULA_FUNCTIONS, FormulaFunction } from './formula-functions';
import { FormulaReference, parseFormulaReferences } from './formula-references';
import { normalizeFormula } from './formula-text';
import { trimToUsedRange } from './sheet-range';
import { insertColumn, insertRow, removeColumn, removeRow } from './sheet-edit';
import { BorderIconComponent } from './border-icon.component';

export type { CellAlign, CellStyle };

export interface Cell {
  value: string;
  style: CellStyle;
}

interface Selection {
  row: number;
  column: number;
}

interface ReferenceInsertion {
  draft: string;
  start: number;
  end: number;
  anchor: Selection;
  focus: Selection;
}

interface ReferenceOutline {
  color: string;
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

interface SheetSnapshot {
  rows: number;
  columns: number;
  cells: Cell[][];
  columnWidths: number[];
  mergedCells?: MergedCell[];
}

interface MergedCell {
  row: number;
  column: number;
  rows: number;
  columns: number;
}

interface Workbook {
  id: string;
  name: string;
  snapshot: SheetSnapshot;
}

interface ClipboardCells {
  values: string[][];
  display: string[][];
  cut: boolean;
  origin: Selection;
}

type ContextSubmenu = 'format';

type MoveDirection = 'up' | 'down' | 'left' | 'right' | 'none';

const DEFAULT_ROWS = 24;
const DEFAULT_COLUMNS = 16;
const DEFAULT_COLUMN_WIDTH = 128;
const MIN_COLUMN_WIDTH = 56;
const MAX_COLUMN_WIDTH = 480;
const ROW_HEADER_WIDTH = 48;
const MAX_HISTORY = 100;

const STORAGE_KEY = 'spreadnext-workbooks';
const REFERENCE_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#a855f7', '#f59e0b', '#06b6d4'];

const DEFAULT_BORDER_COLOR = '#64748b';
const FILL_COLORS = [
  '#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b',
  '#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626',
  '#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c',
  '#fefce8', '#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04',
  '#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a',
  '#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb',
  '#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea'
];

function contrastTextColor(background: string | null): string | null {
  if (!background) {
    return null;
  }

  const hex = normalizeColor(background);
  if (!hex) {
    return null;
  }

  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114;

  return luminance > 150 ? '#0f172a' : '#f8fafc';
}

@Component({
  selector: 'app-spreadsheet',
  imports: [NgIcon, BorderIconComponent],
  templateUrl: './spreadsheet.component.html',
  styleUrl: './spreadsheet.component.css',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class SpreadsheetComponent implements OnInit, OnDestroy {
  @Input() rows = DEFAULT_ROWS;
  @Input() columns = DEFAULT_COLUMNS;
  @Input() documentTitle = 'Untitled spreadsheet';

  @Output() cellChange = new EventEmitter<{ row: number; column: number; value: string }>();
  @Output() sheetChange = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() titleReset = new EventEmitter<void>();

  activeWorkbookIndex = 0;
  workbooks: Workbook[] = [];

  readonly fillColors = FILL_COLORS;
  readonly borderLineStyles: { value: BorderLineStyle; label: string }[] = [
    { value: 'thin', label: 'Thin' },
    { value: 'medium', label: 'Medium' },
    { value: 'thick', label: 'Thick' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
    { value: 'double', label: 'Double' }
  ];
  readonly borderPresets: { id: BorderPreset; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'outer', label: 'Outer' },
    { id: 'inner', label: 'Inner' },
    { id: 'horizontal', label: 'Horizontal' },
    { id: 'vertical', label: 'Vertical' },
    { id: 'top', label: 'Top' },
    { id: 'right', label: 'Right' },
    { id: 'bottom', label: 'Bottom' },
    { id: 'left', label: 'Left' },
    { id: 'diagonalDown', label: 'Diagonal' },
    { id: 'diagonalUp', label: 'Diagonal up' },
    { id: 'none', label: 'None' }
  ];

  cellData: Cell[][] = [];
  mergedCells: MergedCell[] = [];
  displayValues: string[][] = [];
  columnWidths: number[] = [];
  rowIndices: number[] = [];
  columnIndices: number[] = [];

  activeCell: Selection = { row: 0, column: 0 };
  selectionAnchor: Selection = { row: 0, column: 0 };
  editingCell: Selection | null = null;
  draftValue = '';
  formulaValue = '';

  suggestions: FormulaFunction[] = [];
  suggestionIndex = 0;
  suggestionTop = 0;
  suggestionLeft = 0;

  canUndo = false;
  canRedo = false;

  showGridlines = true;
  compactRows = false;
  resizingColumn: number | null = null;
  selecting = false;
  exportMenuOpen = false;
  confirmNewWorkbookOpen = false;
  confirmDeleteSheetOpen = false;
  pendingDeleteWorkbookId: string | null = null;
  pendingDeleteWorkbookName = '';
  renamingWorkbookId: string | null = null;
  renameValue = '';
  sheetTabContextMenuOpen = false;
  sheetTabContextMenuTargetId: string | null = null;
  sheetTabContextMenuX = 0;
  sheetTabContextMenuY = 0;
  draggedWorkbookIndex: number | null = null;
  dragOverWorkbookIndex: number | null = null;
  fillDialogOpen = false;
  textColorDialogOpen = false;
  borderDialogOpen = false;
  contextMenuOpen = false;
  openSubmenu: ContextSubmenu | null = null;
  fillPickerValue = '#fde047';
  textColorPickerValue = '#111827';
  borderLineStyle: BorderLineStyle = 'thin';
  borderColor = DEFAULT_BORDER_COLOR;

  private readonly engine = inject(FormulaEngine);
  private formulaSource: 'cell' | 'formula' | null = null;
  private referencing = false;
  private referenceAnchor: Selection | null = null;
  private referenceFocus: Selection | null = null;
  private referenceCaret = 0;
  private referenceInsertion: ReferenceInsertion | null = null;
  private cachedReferenceFormula = '';
  private cachedFormulaReferences: FormulaReference[] = [];
  private exportReturnFocus: HTMLElement | null = null;
  private newSheetReturnFocus: HTMLElement | null = null;
  private deleteReturnFocus: HTMLElement | null = null;
  private fillReturnFocus: HTMLElement | null = null;
  private textColorReturnFocus: HTMLElement | null = null;
  private borderReturnFocus: HTMLElement | null = null;
  private clipboard: ClipboardCells | null = null;
  private submenuCloseTimer?: ReturnType<typeof setTimeout>;
  private contextMenuElement: HTMLElement | null = null;
  private contextMenuClientX = 0;
  private contextMenuClientY = 0;
  private submenuElement: HTMLElement | null = null;
  private submenuTrigger: HTMLElement | null = null;

  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private resizeDirty = false;
  private recalculateTimer?: ReturnType<typeof setTimeout>;
  private recalculateVersion = 0;

  @ViewChild('grid') private gridRef?: ElementRef<HTMLDivElement>;
  @ViewChild('cellEditor') private editorRef?: ElementRef<HTMLInputElement>;
  @ViewChild('formulaInput') private formulaInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('exportFirst') private exportFirstRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('exportDialog') private exportDialogRef?: ElementRef<HTMLElement>;
  @ViewChild('newSheetCancel') private newSheetCancelRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('deleteSheetCancel') private deleteSheetCancelRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('sheetTabContextMenu') private sheetTabContextMenuRef?: ElementRef<HTMLElement>;
  @ViewChild('newSheetDialog') private newSheetDialogRef?: ElementRef<HTMLElement>;
  @ViewChild('fillFirst') private fillFirstRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('textColorFirst') private textColorFirstRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('textColorDialog') private textColorDialogRef?: ElementRef<HTMLElement>;
  @ViewChild('fillDialog') private fillDialogRef?: ElementRef<HTMLElement>;
  @ViewChild('borderFirst') private borderFirstRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('borderDialog') private borderDialogRef?: ElementRef<HTMLElement>;
  @ViewChild('contextMenu')
  set contextMenuRef(ref: ElementRef<HTMLElement> | undefined) {
    this.contextMenuElement = ref?.nativeElement ?? null;
    if (ref) {
      this.positionContextMenu();
    }
  }

  @ViewChild('contextSubmenu')
  set contextSubmenuRef(ref: ElementRef<HTMLElement> | undefined) {
    this.submenuElement = ref?.nativeElement ?? null;
    if (ref) {
      this.positionSubmenu();
    }
  }
  @ViewChildren('menu') private menuRefs?: QueryList<ElementRef<HTMLDetailsElement>>;

  private history: SheetSnapshot[] = [];
  private historyIndex = -1;
  private saveTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    if (!this.restore()) {
      this.workbooks = [{
        id: crypto.randomUUID(),
        name: 'Sheet1',
        snapshot: {
          rows: DEFAULT_ROWS,
          columns: DEFAULT_COLUMNS,
          cells: this.createCells(DEFAULT_ROWS, DEFAULT_COLUMNS).map(row =>
            row.map(cell => ({
              value: cell.value,
              style: cloneCellStyle(cell.style)
            }))
          ),
           columnWidths: Array(DEFAULT_COLUMNS).fill(DEFAULT_COLUMN_WIDTH),
           mergedCells: []
         }
       }];
      this.activeWorkbookIndex = 0;
    }

    this.rebuildIndices();
    this.columnWidths = this.normalizeColumnWidths(this.columnWidths, this.columns);
    this.activeCell = { row: 0, column: 0 };
    this.formulaValue = this.cellAt(0, 0).value;
    this.resetDisplayValues();
    this.history = [this.currentSnapshot()];
    this.historyIndex = 0;
    this.updateHistoryFlags();
    this.scheduleRecalculate();
  }

  ngOnDestroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    if (this.recalculateTimer) {
      clearTimeout(this.recalculateTimer);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    this.menuRefs?.forEach(menu => {
      if (!menu.nativeElement.contains(event.target as Node)) {
        menu.nativeElement.open = false;
      }
    });
  }

  get activeCellData(): Cell {
    return this.cellAt(this.activeCell.row, this.activeCell.column);
  }

  get activeCellHasBorders(): boolean {
    return [...BORDER_SIDES, ...DIAGONAL_SIDES]
      .some(side => this.activeCellData.style.borders[side] !== null);
  }

  get selectionHasFormatting(): boolean {
    let found = false;

    this.forEachSelectedCell(cell => {
      if (!found && hasCellFormatting(cell.style)) {
        found = true;
      }
    });

    return found;
  }

  get clipboardHasValues(): boolean {
    return this.clipboard !== null && this.clipboard.display.length > 0;
  }

  get activeAddress(): string {
    return `${this.columnLabel(this.activeCell.column)}${this.activeCell.row + 1}`;
  }

  get selectionLabel(): string {
    const start = `${this.columnLabel(this.selectionLeft)}${this.selectionTop + 1}`;
    const end = `${this.columnLabel(this.selectionRight)}${this.selectionBottom + 1}`;
    return start === end ? start : `${start}:${end}`;
  }

  get selectedCellCount(): number {
    return (this.selectionBottom - this.selectionTop + 1) *
      (this.selectionRight - this.selectionLeft + 1);
  }

  get selectionSummary(): string {
    if (this.selectedCellCount < 2) {
      return '';
    }

    let sum = 0;
    let count = 0;

    this.forEachSelectedCell((cell, row, column) => {
      const display = this.displayAt(row, column).trim();
      const value = Number(display);
      if (display !== '' && Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    });

    if (count === 0) {
      return '';
    }

    return `Sum ${this.formatNumber(sum)} · Avg ${this.formatNumber(sum / count)}`;
  }

  get selectionTop(): number {
    return Math.min(this.selectionAnchor.row, this.activeCell.row);
  }

  get selectionBottom(): number {
    return Math.max(this.selectionAnchor.row, this.activeCell.row);
  }

  get selectionLeft(): number {
    return Math.min(this.selectionAnchor.column, this.activeCell.column);
  }

  get selectionRight(): number {
    return Math.max(this.selectionAnchor.column, this.activeCell.column);
  }

  get gridWidth(): number {
    return ROW_HEADER_WIDTH + this.columnWidths.reduce((total, width) => total + width, 0);
  }

  columnWidth(column: number): number {
    return this.columnWidths[column] ?? DEFAULT_COLUMN_WIDTH;
  }

  displayAt(row: number, column: number): string {
    const cell = this.cellAt(row, column);

    if (!cell.value.trimStart().startsWith('=')) {
      return cell.value;
    }

    return this.displayValues[row]?.[column] ?? cell.value;
  }

  cellBorderCss(row: number, column: number, side: BorderSide): string | null {
    return borderCss(this.cellAt(row, column).style.borders[side]);
  }

  cellDiagonalCss(row: number, column: number, side: DiagonalSide): string | null {
    return diagonalGradient(side, this.cellAt(row, column).style.borders[side]);
  }

  cellValueColor(row: number, column: number): string | null {
    const cell = this.cellAt(row, column);
    if (cell.style.color) {
      return cell.style.color;
    }

    const background = cell.style.background;
    if (!background || this.displayAt(row, column).startsWith('#')) {
      return null;
    }

    return contrastTextColor(background);
  }

  cellAt(row: number, column: number): Cell {
    const merge = this.mergedAt(row, column);
    if (merge && (merge.row !== row || merge.column !== column)) {
      return this.cellData[merge.row]?.[merge.column] ?? this.createCell();
    }

    return this.cellData[row]?.[column] ?? this.createCell();
  }

  isActive(row: number, column: number): boolean {
    return this.activeCell.row === row && this.activeCell.column === column;
  }

  isSelected(row: number, column: number): boolean {
    return row >= this.selectionTop &&
      row <= this.selectionBottom &&
      column >= this.selectionLeft &&
      column <= this.selectionRight;
  }

  isColumnInSelection(column: number): boolean {
    return column >= this.selectionLeft && column <= this.selectionRight;
  }

  isRowInSelection(row: number): boolean {
    return row >= this.selectionTop && row <= this.selectionBottom;
  }

  isEditing(row: number, column: number): boolean {
    return this.editingCell?.row === row && this.editingCell?.column === column;
  }

  columnLabel(index: number): string {
    let label = '';
    let value = index + 1;

    while (value > 0) {
      const remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }

    return label;
  }

  selectCell(row: number, column: number, extend = false): void {
    this.commitEdit('none', false);
    this.activeCell = this.clampSelection(row, column);
    if (!extend) {
      this.selectionAnchor = { ...this.activeCell };
    }
    this.formulaValue = this.activeCellData.value;
    this.expandSelectionForMerges();
    this.focusGrid();
  }

  selectAll(): void {
    this.commitEdit('none', false);
    this.activeCell = { row: 0, column: 0 };
    this.selectionAnchor = { row: this.rows - 1, column: this.columns - 1 };
    this.formulaValue = this.activeCellData.value;
    this.focusGrid();
    this.scrollActiveIntoView();
  }

  startCellSelection(event: PointerEvent, row: number, column: number): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.cell-editor')) {
      return;
    }

    if (this.formulaSource === 'formula' && !this.isFormulaEditing()) {
      this.commitFormula();
      this.formulaSource = null;
    }

    if (this.formulaSource !== null && this.isFormulaEditing()) {
      if (this.canInsertReference()) {
        this.startReferenceSelection(event, row, column);
        return;
      }

      if (this.formulaSource === 'formula') {
        this.commitFormula();
        this.formulaSource = null;
      }
    }

    this.selectCell(row, column, event.shiftKey);
    this.selecting = true;
  }

  extendSelection(row: number, column: number): void {
    if (this.referencing) {
      this.referenceFocus = this.clampSelection(row, column);
      return;
    }

    if (!this.selecting) {
      return;
    }

    this.activeCell = this.clampSelection(row, column);
    this.formulaValue = this.activeCellData.value;
    this.expandSelectionForMerges();
  }

  isReferenceCell(row: number, column: number): boolean {
    if (!this.referenceAnchor || !this.referenceFocus) {
      return false;
    }

    return row >= Math.min(this.referenceAnchor.row, this.referenceFocus.row) &&
      row <= Math.max(this.referenceAnchor.row, this.referenceFocus.row) &&
      column >= Math.min(this.referenceAnchor.column, this.referenceFocus.column) &&
      column <= Math.max(this.referenceAnchor.column, this.referenceFocus.column);
  }

  referenceOutlines(row: number, column: number): ReferenceOutline[] {
    const references = this.formulaReferences();
    const outlines: ReferenceOutline[] = [];

    for (const reference of references) {
      if (
        row < reference.top ||
        row > reference.bottom ||
        column < reference.left ||
        column > reference.right
      ) {
        continue;
      }

      outlines.push({
        color: REFERENCE_COLORS[reference.colorIndex % REFERENCE_COLORS.length],
        top: row === reference.top,
        right: column === reference.right,
        bottom: row === reference.bottom,
        left: column === reference.left
      });
    }

    return outlines;
  }

  private formulaReferences(): FormulaReference[] {
    const formula = this.referenceFormula();

    if (formula !== this.cachedReferenceFormula) {
      this.cachedReferenceFormula = formula;
      this.cachedFormulaReferences = parseFormulaReferences(formula);
    }

    return this.cachedFormulaReferences;
  }

  private referenceFormula(): string {
    if (this.formulaSource === 'formula') {
      return this.formulaValue;
    }

    if (this.formulaSource === 'cell') {
      return this.draftValue;
    }

    return this.activeCellData.value;
  }

  @HostListener('document:pointerup')
  endSelection(): void {
    if (this.referencing) {
      this.finishReferenceSelection();
      return;
    }

    this.selecting = false;
  }

  @HostListener('document:pointercancel')
  cancelSelection(): void {
    this.selecting = false;
    this.referencing = false;
    this.referenceAnchor = null;
    this.referenceFocus = null;
  }

  startEdit(initialValue?: string): void {
    if (this.editingCell) {
      return;
    }

    const cell = this.activeCellData;
    this.formulaSource = 'cell';
    this.selectionAnchor = { ...this.activeCell };
    this.editingCell = { ...this.activeCell };
    this.draftValue = initialValue ?? cell.value;
    this.formulaValue = this.draftValue;
    this.referenceInsertion = null;

    setTimeout(() => {
      const editor = this.editorRef?.nativeElement;
      if (!editor) {
        return;
      }

      editor.focus();
      if (initialValue === undefined) {
        editor.select();
      } else {
        editor.setSelectionRange(editor.value.length, editor.value.length);
      }

      this.updateSuggestions(editor.value, editor.selectionStart ?? editor.value.length);
    });
  }

  onEditorInput(event: Event): void {
    const editor = event.target as HTMLInputElement;
    this.formulaSource = 'cell';
    this.draftValue = editor.value;
    this.formulaValue = this.draftValue;
    this.referenceInsertion = null;
    this.updateSuggestions(editor.value, editor.selectionStart ?? editor.value.length);
  }

  onEditorBlur(): void {
    if (this.referencing) {
      return;
    }

    this.formulaSource = null;
    this.hideSuggestions();
    this.commitEdit('none', false);
  }

  onEditorKeydown(event: KeyboardEvent): void {
    if (this.isSaveShortcut(event)) {
      return;
    }

    if (event.isComposing) {
      return;
    }

    event.stopPropagation();

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.commitEdit(event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }

    if (this.handleSuggestionKey(event)) {
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const editor = event.target as HTMLInputElement;
      const start = editor.selectionStart ?? 0;
      const end = editor.selectionEnd ?? start;
      const atBoundary = start === end && (
        (event.key === 'ArrowLeft' && start === 0) ||
        (event.key === 'ArrowRight' && start === editor.value.length)
      );

      if (atBoundary) {
        event.preventDefault();
        this.commitEdit(event.key === 'ArrowLeft' ? 'left' : 'right');
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitEdit(event.shiftKey ? 'up' : 'down');
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this.commitEdit(event.shiftKey ? 'left' : 'right');
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    }
  }

  commitEdit(move: MoveDirection = 'none', focus = true): void {
    const editing = this.editingCell;
    if (!editing) {
      return;
    }

    const cell = this.cellAt(editing.row, editing.column);
    const value = normalizeFormula(this.draftValue);
    this.editingCell = null;
    this.draftValue = '';
    this.formulaSource = null;
    this.referenceInsertion = null;
    this.hideSuggestions();

    if (cell.value !== value) {
      cell.value = value;
      this.cellChange.emit({ row: editing.row, column: editing.column, value });
      this.pushHistory();
    }

    this.formulaValue = cell.value;

    if (move !== 'none') {
      this.moveSelection(move);
    } else if (focus) {
      this.focusGrid();
    }
  }

  cancelEdit(): void {
    const editing = this.editingCell;
    if (!editing) {
      return;
    }

    this.editingCell = null;
    this.draftValue = '';
    this.formulaSource = null;
    this.referenceInsertion = null;
    this.hideSuggestions();
    this.formulaValue = this.cellAt(editing.row, editing.column).value;
    this.focusGrid();
  }

  private isFormulaEditing(): boolean {
    return this.formulaSource !== null && this.currentDraft().trimStart().startsWith('=');
  }

  private isSaveShortcut(event: KeyboardEvent): boolean {
    return (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === 's';
  }

  private currentDraft(): string {
    return this.formulaSource === 'formula' ? this.formulaValue : this.draftValue;
  }

  private setDraft(value: string): void {
    if (this.formulaSource === 'formula') {
      this.formulaValue = value;
    } else {
      this.draftValue = value;
      this.formulaValue = value;
    }
  }

  private activeInput(): HTMLInputElement | undefined {
    return this.formulaSource === 'formula'
      ? this.formulaInputRef?.nativeElement
      : this.editorRef?.nativeElement;
  }

  private canInsertReference(): boolean {
    const text = this.currentDraft();
    const input = this.activeInput();
    const previous = this.referenceInsertion;

    if (
      previous &&
      previous.draft === text &&
      input &&
      input.selectionStart === previous.end &&
      input.selectionEnd === previous.end
    ) {
      return true;
    }

    const caret = input?.selectionStart ?? text.length;
    const before = text.slice(0, caret).trimEnd();

    return before.length > 0 && /[(,+\-*/^&<>=]$/.test(before);
  }

  private startReferenceSelection(event: PointerEvent, row: number, column: number): void {
    event.preventDefault();
    event.stopPropagation();

    const input = this.activeInput();
    const draft = this.currentDraft();
    const previous = this.referenceInsertion;
    let caret = input?.selectionStart ?? draft.length;
    let anchor = this.clampSelection(row, column);

    if (
      previous &&
      previous.draft === draft &&
      input &&
      input.selectionStart === previous.end &&
      input.selectionEnd === previous.end
    ) {
      if (event.shiftKey) {
        anchor = { ...previous.anchor };
      }

      this.setDraft(draft.slice(0, previous.start) + draft.slice(previous.end));
      caret = previous.start;
      this.referenceInsertion = null;
    } else if (previous?.draft !== draft) {
      this.referenceInsertion = null;
    }

    this.referenceCaret = caret;
    this.referenceAnchor = anchor;
    this.referenceFocus = this.clampSelection(row, column);
    this.referencing = true;
    this.selecting = false;
    this.hideSuggestions();
  }

  private finishReferenceSelection(): void {
    const anchor = this.referenceAnchor;
    const focus = this.referenceFocus;

    this.referencing = false;
    this.referenceAnchor = null;
    this.referenceFocus = null;

    if (!anchor || !focus) {
      return;
    }

    const reference = this.referenceLabel(anchor, focus);
    const draft = this.currentDraft();
    const caret = this.clamp(this.referenceCaret, 0, draft.length);
    const value = `${draft.slice(0, caret)}${reference}${draft.slice(caret)}`;

    this.setDraft(value);
    this.referenceInsertion = {
      draft: value,
      start: caret,
      end: caret + reference.length,
      anchor: { ...anchor },
      focus: { ...focus }
    };
    this.focusActiveInput(caret + reference.length);
  }

  private referenceLabel(anchor: Selection, focus: Selection): string {
    const top = Math.min(anchor.row, focus.row);
    const bottom = Math.max(anchor.row, focus.row);
    const left = Math.min(anchor.column, focus.column);
    const right = Math.max(anchor.column, focus.column);
    const start = `${this.columnLabel(left)}${top + 1}`;
    const end = `${this.columnLabel(right)}${bottom + 1}`;
    return start === end ? start : `${start}:${end}`;
  }

  private focusActiveInput(position: number): void {
    setTimeout(() => {
      const input = this.activeInput();
      if (!input) {
        return;
      }

      input.focus();
      input.setSelectionRange(position, position);
    });
  }

  private updateSuggestions(text: string, caret: number): void {
    const query = this.suggestionQuery(text, caret);

    if (query === null) {
      this.hideSuggestions();
      return;
    }

    const matches = FORMULA_FUNCTIONS
      .filter(formula => formula.name.startsWith(query))
      .slice(0, 8);

    if (matches.length === 0) {
      this.hideSuggestions();
      return;
    }

    const input = this.activeInput();
    if (input) {
      const rect = input.getBoundingClientRect();
      const width = 380;
      const height = 280;
      this.suggestionLeft = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      this.suggestionTop = rect.bottom + height > window.innerHeight
        ? Math.max(8, rect.top - height - 6)
        : rect.bottom + 6;
    }

    this.suggestions = matches;
    this.suggestionIndex = 0;
  }

  private suggestionQuery(text: string, caret: number): string | null {
    const before = text.slice(0, caret);
    const equals = before.indexOf('=');

    if (equals === -1 || before.slice(0, equals).trim() !== '') {
      return null;
    }

    const after = before.slice(equals + 1);
    let quoteOpen = false;
    for (const character of after) {
      if (character === '"') {
        quoteOpen = !quoteOpen;
      }
    }

    if (quoteOpen) {
      return null;
    }

    const token = /([A-Za-z][A-Za-z0-9.]*)$/.exec(after);
    if (token) {
      return token[1].toUpperCase();
    }

    const trimmed = after.trimEnd();
    if (trimmed === '' || /[(,+\-*/^&<>=]$/.test(trimmed)) {
      return '';
    }

    return null;
  }

  private handleSuggestionKey(event: KeyboardEvent): boolean {
    if (this.suggestions.length === 0) {
      return false;
    }

    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      this.hideSuggestions();
      return false;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      this.suggestionIndex = (this.suggestionIndex + direction + this.suggestions.length) % this.suggestions.length;
      return true;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.insertSuggestion(this.suggestionIndex);
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.hideSuggestions();
      return true;
    }

    return false;
  }

  insertSuggestion(index: number): void {
    const suggestion = this.suggestions[index];
    if (!suggestion) {
      return;
    }

    const input = this.activeInput();
    const text = this.currentDraft();
    const caret = input?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const token = /([A-Za-z][A-Za-z0-9.]*)$/.exec(before);
    const start = token ? caret - token[1].length : caret;
    const inserted = `${suggestion.name}(`;
    const value = `${text.slice(0, start)}${inserted}${text.slice(caret)}`;

    this.setDraft(value);
    this.referenceInsertion = null;
    this.hideSuggestions();
    this.focusActiveInput(start + inserted.length);
  }

  onEditorCaret(): void {
    const editor = this.editorRef?.nativeElement;
    if (editor) {
      this.updateSuggestions(editor.value, editor.selectionStart ?? editor.value.length);
    }
  }

  onEditorKeyup(event: KeyboardEvent): void {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      return;
    }

    this.onEditorCaret();
  }

  private hideSuggestions(): void {
    this.suggestions = [];
    this.suggestionIndex = 0;
  }

  onFormulaFocus(): void {
    this.formulaSource = 'formula';
    const input = this.formulaInputRef?.nativeElement;
    if (input) {
      this.updateSuggestions(input.value, input.selectionStart ?? input.value.length);
    }
  }

  onFormulaInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.formulaSource = 'formula';
    this.formulaValue = input.value;
    this.referenceInsertion = null;
    this.updateSuggestions(input.value, input.selectionStart ?? input.value.length);
  }

  onFormulaBlur(): void {
    if (this.referencing) {
      return;
    }

    const wasEditing = this.formulaSource === 'formula';
    this.formulaSource = null;
    this.hideSuggestions();

    if (wasEditing) {
      this.commitFormula();
    }
  }

  onFormulaKeydown(event: KeyboardEvent): void {
    if (this.handleSuggestionKey(event)) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitFormula(event);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.formulaValue = this.activeCellData.value;
      this.hideSuggestions();
      this.formulaSource = null;
      this.formulaInputRef?.nativeElement.blur();
    }
  }

  onFormulaCaret(): void {
    const input = this.formulaInputRef?.nativeElement;
    if (input) {
      this.updateSuggestions(input.value, input.selectionStart ?? input.value.length);
    }
  }

  onFormulaKeyup(event: KeyboardEvent): void {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      return;
    }

    this.onFormulaCaret();
  }

  onGridKeydown(event: KeyboardEvent): void {
    if (this.editingCell) {
      const key = event.key;
      if (key === 'Backspace') {
        event.preventDefault();
        this.draftValue = this.draftValue.slice(0, -1);
        this.formulaValue = this.draftValue;
        this.referenceInsertion = null;
        this.updateSuggestions(this.draftValue, this.draftValue.length);
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && key.length === 1) {
        event.preventDefault();
        this.draftValue += key;
        this.formulaValue = this.draftValue;
        this.referenceInsertion = null;
        this.updateSuggestions(this.draftValue, this.draftValue.length);
      }
      return;
    }

    const key = event.key;
    const modifier = event.ctrlKey || event.metaKey;

    if (modifier) {
      switch (key.toLowerCase()) {
        case 'z':
          event.preventDefault();
          event.shiftKey ? this.redo() : this.undo();
          return;
        case 'y':
          event.preventDefault();
          this.redo();
          return;
        case 'b':
          event.preventDefault();
          this.toggleStyle('bold');
          return;
        case 'i':
          event.preventDefault();
          this.toggleStyle('italic');
          return;
        case 'u':
          event.preventDefault();
          this.toggleStyle('underline');
          return;
        case 'a':
          event.preventDefault();
          this.selectAll();
          return;
        case 'c':
          event.preventDefault();
          this.copySelection();
          return;
        case 'x':
          event.preventDefault();
          this.cutSelection();
          return;
        case 'v':
          event.preventDefault();
          void this.pasteClipboard();
          return;
      }
    }

    switch (key) {
      case 'ArrowUp':
        event.preventDefault();
        if (event.shiftKey) {
          this.extendSelectionKeyboard('up');
        } else {
          this.moveSelection('up');
        }
        return;
      case 'ArrowDown':
        event.preventDefault();
        if (event.shiftKey) {
          this.extendSelectionKeyboard('down');
        } else {
          this.moveSelection('down');
        }
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (event.shiftKey) {
          this.extendSelectionKeyboard('left');
        } else {
          this.moveSelection('left');
        }
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (event.shiftKey) {
          this.extendSelectionKeyboard('right');
        } else {
          this.moveSelection('right');
        }
        return;
      case 'Tab':
        event.preventDefault();
        this.moveSelection(event.shiftKey ? 'left' : 'right');
        return;
      case 'Enter':
      case 'F2':
        event.preventDefault();
        this.startEdit();
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.clearActiveCell();
        return;
      case 'Escape':
        if (this.selectedCellCount > 1) {
          event.preventDefault();
          this.selectionAnchor = { ...this.activeCell };
        }
        return;
      case 'Home':
        event.preventDefault();
        this.activeCell = { row: event.ctrlKey ? 0 : this.activeCell.row, column: 0 };
        this.selectionAnchor = { ...this.activeCell };
        this.formulaValue = this.activeCellData.value;
        this.focusGrid();
        this.scrollActiveIntoView();
        return;
    }

    if (!modifier && !event.altKey && key.length === 1) {
      event.preventDefault();
      this.startEdit(key);
    }
  }

  moveSelection(direction: Exclude<MoveDirection, 'none'>): void {
    const next = this.stepCell(this.activeCell.row, this.activeCell.column, direction);
    let row = next.row;
    let column = next.column;

    if (row >= this.rows) {
      this.addRow();
    }
    if (column >= this.columns) {
      this.addColumn();
    }

    this.activeCell = {
      row: this.clamp(row, 0, this.rows - 1),
      column: this.clamp(column, 0, this.columns - 1)
    };
    this.selectionAnchor = { ...this.activeCell };
    this.formulaValue = this.activeCellData.value;
    this.focusGrid();
    this.scrollActiveIntoView();
  }

  extendSelectionKeyboard(direction: 'up' | 'down' | 'left' | 'right'): void {
    const next = this.stepCell(this.activeCell.row, this.activeCell.column, direction);
    let row = next.row;
    let column = next.column;

    if (row >= this.rows) {
      this.addRow();
    }
    if (column >= this.columns) {
      this.addColumn();
    }

    this.activeCell = this.clampSelection(row, column);
    this.formulaValue = this.activeCellData.value;
    this.expandSelectionForMerges();
    this.focusGrid();
    this.scrollActiveIntoView();
  }

  addRow(): void {
    this.rows += 1;
    this.cellData.push(Array.from({ length: this.columns }, () => this.createCell()));
    this.rebuildIndices();
    this.pushHistory();
  }

  addColumn(): void {
    this.columns += 1;
    this.columnWidths.push(DEFAULT_COLUMN_WIDTH);
    this.cellData.forEach(row => row.push(this.createCell()));
    this.rebuildIndices();
    this.pushHistory();
  }

  startColumnResize(event: PointerEvent, column: number): void {
    event.stopPropagation();

    this.resizingColumn = column;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.columnWidth(column);
    this.resizeDirty = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  resizeColumn(event: PointerEvent): void {
    if (this.resizingColumn === null) {
      return;
    }

    const width = this.clamp(
      Math.round(this.resizeStartWidth + event.clientX - this.resizeStartX),
      MIN_COLUMN_WIDTH,
      MAX_COLUMN_WIDTH
    );

    if (width !== this.columnWidths[this.resizingColumn]) {
      this.columnWidths[this.resizingColumn] = width;
      this.resizeDirty = true;
    }
  }

  endColumnResize(event: PointerEvent): void {
    if (this.resizingColumn === null) {
      return;
    }

    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }

    this.resizingColumn = null;

    if (this.resizeDirty) {
      this.pushHistory();
      this.resizeDirty = false;
    }
  }

  resetColumnWidth(event: MouseEvent, column: number): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.columnWidths[column] === DEFAULT_COLUMN_WIDTH) {
      return;
    }

    this.columnWidths[column] = DEFAULT_COLUMN_WIDTH;
    this.pushHistory();
  }

  clearActiveCell(): void {
    let changed = false;

    this.forEachSelectedCell(cell => {
      if (cell.value !== '') {
        cell.value = '';
        changed = true;
      }
    });

    if (!changed) {
      return;
    }

    this.formulaValue = '';
    this.cellChange.emit({
      row: this.activeCell.row,
      column: this.activeCell.column,
      value: ''
    });
    this.pushHistory();
  }

  toggleStyle(style: 'bold' | 'italic' | 'underline' | 'strike'): void {
    const next = !this.activeCellData.style[style];
    this.forEachSelectedCell(cell => cell.style[style] = next);
    this.pushHistory();
  }

  clearFormatting(): void {
    let changed = false;

    this.forEachSelectedCell(cell => {
      if (hasCellFormatting(cell.style)) {
        cell.style = clearCellFormatting();
        changed = true;
      }
    });

    if (changed) {
      this.pushHistory();
    }
  }

  setAlignment(align: CellAlign): void {
    let changed = false;

    this.forEachSelectedCell(cell => {
      if (cell.style.align !== align) {
        cell.style.align = align;
        changed = true;
      }
    });

    if (changed) {
      this.pushHistory();
    }
  }

  openFillDialog(): void {
    if (this.textColorDialogOpen || this.fillDialogOpen || this.borderDialogOpen || this.confirmNewWorkbookOpen || this.exportMenuOpen) {
      return;
    }

    this.fillReturnFocus = this.beginStyleDialog();
    this.fillPickerValue = this.activeCellData.style.background ?? '#fde047';
    this.fillDialogOpen = true;
    setTimeout(() => this.fillFirstRef?.nativeElement.focus({ preventScroll: true }));
  }

  closeFillDialog(): void {
    if (!this.fillDialogOpen) {
      return;
    }

    this.fillDialogOpen = false;
    const target = this.fillReturnFocus;
    this.fillReturnFocus = null;
    this.restoreDialogFocus(target);
  }

  onFillPickerInput(event: Event): void {
    this.fillPickerValue = (event.target as HTMLInputElement).value;
  }

  onFillDialogKeydown(event: KeyboardEvent): void {
    this.handleStyleDialogKeydown(event, this.fillDialogRef?.nativeElement, () => this.closeFillDialog());
  }

  applyFill(color: string | null): void {
    const background = color ? normalizeColor(color) : null;
    if (color && !background) {
      return;
    }

    let changed = false;
    this.forEachSelectedCell(cell => {
      if (cell.style.background !== background) {
        cell.style.background = background;
        changed = true;
      }
    });

    if (changed) {
      this.pushHistory();
    }

    this.fillDialogOpen = false;
    this.fillReturnFocus = null;
    this.focusGrid();
  }

  openTextColorDialog(): void {
    if (this.textColorDialogOpen || this.textColorDialogOpen || this.fillDialogOpen || this.borderDialogOpen || this.confirmNewWorkbookOpen || this.exportMenuOpen) {
      return;
    }

    this.textColorReturnFocus = this.beginStyleDialog();
    this.textColorPickerValue = this.activeCellData.style.color ?? '#111827';
    this.textColorDialogOpen = true;
    setTimeout(() => this.textColorFirstRef?.nativeElement.focus({ preventScroll: true }));
  }

  closeTextColorDialog(): void {
    if (!this.textColorDialogOpen) {
      return;
    }

    this.textColorDialogOpen = false;
    const target = this.textColorReturnFocus;
    this.textColorReturnFocus = null;
    this.restoreDialogFocus(target);
  }

  onTextColorPickerInput(event: Event): void {
    this.textColorPickerValue = (event.target as HTMLInputElement).value;
  }

  onTextColorDialogKeydown(event: KeyboardEvent): void {
    this.handleStyleDialogKeydown(event, this.textColorDialogRef?.nativeElement, () => this.closeTextColorDialog());
  }

  applyTextColor(color: string | null): void {
    const textColor = color ? normalizeColor(color) : null;
    if (color && !textColor) {
      return;
    }

    let changed = false;
    this.forEachSelectedCell(cell => {
      if (cell.style.color !== textColor) {
        cell.style.color = textColor;
        changed = true;
      }
    });

    if (changed) {
      this.pushHistory();
    }

    this.textColorDialogOpen = false;
    this.textColorReturnFocus = null;
    this.focusGrid();
  }

  openBorderDialog(): void {
    if (this.textColorDialogOpen || this.fillDialogOpen || this.borderDialogOpen || this.confirmNewWorkbookOpen || this.exportMenuOpen) {
      return;
    }

    this.borderReturnFocus = this.beginStyleDialog();
    const border = [...BORDER_SIDES, ...DIAGONAL_SIDES]
      .map(side => this.activeCellData.style.borders[side])
      .find((value): value is CellBorder => value !== null);
    this.borderLineStyle = border?.style ?? 'thin';
    this.borderColor = border?.color ?? DEFAULT_BORDER_COLOR;
    this.borderDialogOpen = true;
    setTimeout(() => this.borderFirstRef?.nativeElement.focus({ preventScroll: true }));
  }

  closeBorderDialog(): void {
    if (!this.borderDialogOpen) {
      return;
    }

    this.borderDialogOpen = false;
    const target = this.borderReturnFocus;
    this.borderReturnFocus = null;
    this.restoreDialogFocus(target);
  }

  onBorderStyleChange(event: Event): void {
    this.borderLineStyle = (event.target as HTMLSelectElement).value as BorderLineStyle;
  }

  onBorderColorInput(event: Event): void {
    this.borderColor = (event.target as HTMLInputElement).value;
  }

  onBorderDialogKeydown(event: KeyboardEvent): void {
    this.handleStyleDialogKeydown(event, this.borderDialogRef?.nativeElement, () => this.closeBorderDialog());
  }

  applyBorderPreset(preset: BorderPreset): void {
    const border: CellBorder | null = preset === 'none'
      ? null
      : {
        style: this.borderLineStyle,
        color: normalizeColor(this.borderColor) ?? DEFAULT_BORDER_COLOR
      };
    const range = {
      top: this.selectionTop,
      right: this.selectionRight,
      bottom: this.selectionBottom,
      left: this.selectionLeft
    };
    const changed = applyBorderPreset(
      (row, column) => this.cellData[row]?.[column]?.style.borders ?? null,
      range,
      preset,
      border
    );

    if (changed) {
      this.pushHistory();
    }

    this.borderDialogOpen = false;
    this.borderReturnFocus = null;
    this.focusGrid();
  }

  toggleGridlines(): void {
    this.showGridlines = !this.showGridlines;
  }

  openContextMenu(event: MouseEvent, row: number, column: number): void {
    if ((event.target as HTMLElement).closest('.cell-editor')) {
      return;
    }

    event.preventDefault();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.hideSuggestions();
    this.closeMenus();

    if (!this.isSelected(row, column)) {
      this.selectCell(row, column);
    }

    this.contextMenuOpen = true;
    this.contextMenuClientX = event.clientX;
    this.contextMenuClientY = event.clientY;
    setTimeout(() => this.focusContextMenuItem());
  }

  closeContextMenu(): void {
    this.contextMenuOpen = false;
    this.openSubmenu = null;
  }

  onContextMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();

      if (this.openSubmenu) {
        this.openSubmenu = null;
        return;
      }

      this.closeContextMenu();
      this.focusGrid();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveContextMenuFocus(event.key === 'ArrowDown' ? 1 : -1);
    }
  }

  openSubmenuPanel(id: ContextSubmenu, event: Event): void {
    this.cancelSubmenuClose();
    const trigger = event.currentTarget as HTMLElement | null;

    if (!trigger) {
      return;
    }

    this.submenuTrigger = trigger;

    if (this.openSubmenu === id) {
      this.positionSubmenu();
      return;
    }

    this.openSubmenu = id;
    setTimeout(() => this.positionSubmenu());
    requestAnimationFrame(() => this.positionSubmenu());
  }

  scheduleSubmenuClose(): void {
    this.cancelSubmenuClose();
    this.submenuCloseTimer = setTimeout(() => {
      this.openSubmenu = null;
    }, 180);
  }

  cancelSubmenuClose(): void {
    if (this.submenuCloseTimer) {
      clearTimeout(this.submenuCloseTimer);
      this.submenuCloseTimer = undefined;
    }
  }

  cutSelection(): void {
    this.clipboard = {
      values: this.selectionValues(),
      display: this.selectionDisplayValues(),
      cut: true,
      origin: { row: this.selectionTop, column: this.selectionLeft }
    };
    this.writeSystemClipboard();
    this.finishContextAction();
  }

  copySelection(): void {
    this.clipboard = {
      values: this.selectionValues(),
      display: this.selectionDisplayValues(),
      cut: false,
      origin: { row: this.selectionTop, column: this.selectionLeft }
    };
    this.writeSystemClipboard();
    this.finishContextAction();
  }

  async pasteClipboard(): Promise<void> {
    const values = this.clipboard?.values ?? await this.readSystemClipboard();
    this.closeContextMenu();

    if (!values?.length) {
      this.focusGrid();
      return;
    }

    this.pasteValues(values);

    if (this.clipboard?.cut) {
      const cleared = this.clearRange(this.clipboard.origin, values);
      this.clipboard = null;
      if (cleared) {
        this.formulaValue = this.activeCellData.value;
        this.pushHistory();
      }
    }

    this.focusGrid();
  }

  pasteValuesOnly(): void {
    const values = this.clipboard?.display;
    this.closeContextMenu();

    if (!values?.length) {
      this.focusGrid();
      return;
    }

    this.pasteValues(values);

    if (this.clipboard?.cut) {
      const cleared = this.clearRange(this.clipboard.origin, values);
      this.clipboard = null;
      if (cleared) {
        this.formulaValue = this.activeCellData.value;
        this.pushHistory();
      }
    }

    this.focusGrid();
  }

  insertRowAbove(): void {
    const index = this.activeCell.row;
    insertRow(this.cellData, index, () =>
      Array.from({ length: this.columns }, () => this.createCell())
    );
    this.rows += 1;
    this.rebuildIndices();
    this.activeCell = { row: index, column: this.activeCell.column };
    this.selectionAnchor = { ...this.activeCell };
    this.formulaValue = this.activeCellData.value;
    this.pushHistory();
    this.finishContextAction();
  }

  insertColumnLeft(): void {
    const index = this.activeCell.column;
    insertColumn(this.cellData, index, () => this.createCell());
    this.columns += 1;
    this.columnWidths.splice(index, 0, DEFAULT_COLUMN_WIDTH);
    this.rebuildIndices();
    this.activeCell = { row: this.activeCell.row, column: index };
    this.selectionAnchor = { ...this.activeCell };
    this.formulaValue = this.activeCellData.value;
    this.pushHistory();
    this.finishContextAction();
  }

  deleteRow(): void {
    if (this.rows <= 1) {
      return;
    }

    const index = this.activeCell.row;
    removeRow(this.cellData, index);
    this.rows -= 1;
    this.rebuildIndices();
    this.activeCell = {
      row: Math.min(index, this.rows - 1),
      column: Math.min(this.activeCell.column, this.columns - 1)
    };
    this.selectionAnchor = { ...this.activeCell };
    this.formulaValue = this.activeCellData.value;
    this.pushHistory();
    this.finishContextAction();
  }

  deleteColumn(): void {
    if (this.columns <= 1) {
      return;
    }

    const index = this.activeCell.column;
    removeColumn(this.cellData, index);
    this.columns -= 1;
    this.columnWidths.splice(index, 1);
    this.rebuildIndices();
    this.activeCell = {
      row: Math.min(this.activeCell.row, this.rows - 1),
      column: Math.min(index, this.columns - 1)
    };
    this.selectionAnchor = { ...this.activeCell };
    this.formulaValue = this.activeCellData.value;
    this.pushHistory();
    this.finishContextAction();
  }

  toggleCompactRows(): void {
    this.compactRows = !this.compactRows;
  }

  undo(): void {
    if (this.historyIndex <= 0) {
      return;
    }

    this.commitEdit('none', false);
    if (this.historyIndex <= 0) {
      return;
    }

    this.historyIndex -= 1;
    this.restoreSnapshot(this.history[this.historyIndex]);
    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
    this.updateHistoryFlags();
    this.sheetChange.emit();
    this.scheduleSave();
    this.scheduleRecalculate();
    this.focusGrid();
  }

  redo(): void {
    if (this.historyIndex >= this.history.length - 1) {
      return;
    }

    this.commitEdit('none', false);
    this.historyIndex += 1;
    this.restoreSnapshot(this.history[this.historyIndex]);
    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
    this.updateHistoryFlags();
    this.sheetChange.emit();
    this.scheduleSave();
    this.scheduleRecalculate();
    this.focusGrid();
  }

  requestNewWorkbook(): void {
    if (this.confirmNewWorkbookOpen || this.exportMenuOpen) {
      return;
    }

    const active = document.activeElement;
    this.newSheetReturnFocus = active instanceof HTMLElement ? active : null;
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.closeMenus();
    this.hideSuggestions();
    this.confirmNewWorkbookOpen = true;
    setTimeout(() => this.newSheetCancelRef?.nativeElement.focus({ preventScroll: true }));
  }

  cancelNewSheet(): void {
    if (!this.confirmNewWorkbookOpen) {
      return;
    }

    this.confirmNewWorkbookOpen = false;
    const target = this.newSheetReturnFocus;
    this.newSheetReturnFocus = null;

    if (target?.isConnected && target.getClientRects().length > 0) {
      target.focus();
    } else {
      this.focusGrid();
    }
  }

  confirmNewWorkbook(): void {
    if (!this.confirmNewWorkbookOpen) {
      return;
    }

    this.confirmNewWorkbookOpen = false;
    this.newSheetReturnFocus = null;
    this.commitRename();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.closeMenus();
    this.hideSuggestions();

    const freshWorkbook: Workbook = {
      id: crypto.randomUUID(),
      name: 'Sheet1',
      snapshot: {
        rows: DEFAULT_ROWS,
        columns: DEFAULT_COLUMNS,
        cells: this.createCells(DEFAULT_ROWS, DEFAULT_COLUMNS).map(row =>
          row.map(cell => ({
            value: cell.value,
            style: cloneCellStyle(cell.style)
          }))
        ),
        columnWidths: Array(DEFAULT_COLUMNS).fill(DEFAULT_COLUMN_WIDTH),
        mergedCells: []
      }
    };

    this.workbooks = [freshWorkbook];
    this.activeWorkbookIndex = 0;
    this.rows = DEFAULT_ROWS;
    this.columns = DEFAULT_COLUMNS;
    this.cellData = freshWorkbook.snapshot.cells.map(row => row.map(cell => ({
      value: cell.value,
      style: cloneCellStyle(cell.style)
    })));
    this.columnWidths = this.normalizeColumnWidths(freshWorkbook.snapshot.columnWidths, this.columns);
    this.rebuildIndices();
    this.activeCell = { row: 0, column: 0 };
    this.selectionAnchor = { row: 0, column: 0 };
    this.formulaValue = '';
    this.resetDisplayValues();
    this.history = [this.currentSnapshot()];
    this.historyIndex = 0;
    this.updateHistoryFlags();
    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
    this.sheetChange.emit();
    this.titleReset.emit();
    this.scheduleSave();
    this.scheduleRecalculate();
    this.focusGrid();
  }

  requestNewSheet(): void {
    this.requestNewWorkbook();
  }

  confirmNewSheet(): void {
    this.confirmNewWorkbook();
  }

  addWorkbook(): void {
    this.commitRename();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.closeMenus();
    this.hideSuggestions();

    const newWorkbook: Workbook = {
      id: crypto.randomUUID(),
      name: `Sheet${this.workbooks.length + 1}`,
      snapshot: {
        rows: DEFAULT_ROWS,
        columns: DEFAULT_COLUMNS,
        cells: this.createCells(DEFAULT_ROWS, DEFAULT_COLUMNS).map(row =>
          row.map(cell => ({
            value: cell.value,
            style: cloneCellStyle(cell.style)
          }))
        ),
        columnWidths: Array(DEFAULT_COLUMNS).fill(DEFAULT_COLUMN_WIDTH),
        mergedCells: []
      }
    };

    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();

    this.workbooks.push(newWorkbook);
    this.activeWorkbookIndex = this.workbooks.length - 1;
    this.rows = DEFAULT_ROWS;
    this.columns = DEFAULT_COLUMNS;
    this.cellData = newWorkbook.snapshot.cells.map(row => row.map(cell => ({
      value: cell.value,
      style: cloneCellStyle(cell.style)
    })));
    this.columnWidths = this.normalizeColumnWidths(newWorkbook.snapshot.columnWidths, this.columns);
    this.rebuildIndices();
    this.activeCell = { row: 0, column: 0 };
    this.selectionAnchor = { row: 0, column: 0 };
    this.formulaValue = '';
    this.resetDisplayValues();
    this.history = [this.currentSnapshot()];
    this.historyIndex = 0;
    this.updateHistoryFlags();
    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
    this.sheetChange.emit();
    this.titleReset.emit();
    this.scheduleSave();
    this.scheduleRecalculate();
    this.focusGrid();
  }

  switchWorkbook(index: number, focusGridAfter = true): void {
    if (index < 0 || index >= this.workbooks.length || index === this.activeWorkbookIndex) {
      return;
    }

    this.commitRename();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.closeMenus();
    this.hideSuggestions();

    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();

    this.activeWorkbookIndex = index;
    const workbook = this.workbooks[index];
    this.rows = workbook.snapshot.rows;
    this.columns = workbook.snapshot.columns;
    this.cellData = workbook.snapshot.cells.map(row => row.map(cell => ({
      value: cell.value,
      style: cloneCellStyle(cell.style)
    })));
    this.columnWidths = this.normalizeColumnWidths(workbook.snapshot.columnWidths, this.columns);
    this.mergedCells = workbook.snapshot.mergedCells ? workbook.snapshot.mergedCells.map(merge => ({ ...merge })) : [];
    this.rebuildIndices();
    this.activeCell = { row: 0, column: 0 };
    this.selectionAnchor = { row: 0, column: 0 };
    this.formulaValue = this.cellAt(0, 0).value;
    this.resetDisplayValues();
    this.history = [this.currentSnapshot()];
    this.historyIndex = 0;
    this.updateHistoryFlags();
    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
    this.sheetChange.emit();
    this.scheduleSave();
    this.scheduleRecalculate();

    if (focusGridAfter) {
      this.focusGrid();
    }
  }

  mergedAt(row: number, column: number): MergedCell | null {
    return this.mergedCells.find(merge =>
      row >= merge.row &&
      row < merge.row + merge.rows &&
      column >= merge.column &&
      column < merge.column + merge.columns
    ) ?? null;
  }

  isMergedHidden(row: number, column: number): boolean {
    const merge = this.mergedAt(row, column);
    return merge !== null && (merge.row !== row || merge.column !== column);
  }

  expandSelectionForMerges(): void {
    let top = this.selectionTop;
    let left = this.selectionLeft;
    let bottom = this.selectionBottom;
    let right = this.selectionRight;

    let changed = true;
    let iterations = 0;

    while (changed && iterations < this.rows + this.columns + 5) {
      changed = false;
      iterations += 1;

      for (const merge of this.mergedCells) {
        const mergeBottom = merge.row + merge.rows - 1;
        const mergeRight = merge.column + merge.columns - 1;
        const intersects =
          mergeBottom >= top &&
          merge.row <= bottom &&
          mergeRight >= left &&
          merge.column <= right;

        if (!intersects) {
          continue;
        }

        if (merge.row < top) {
          top = merge.row;
          changed = true;
        }
        if (mergeBottom > bottom) {
          bottom = mergeBottom;
          changed = true;
        }
        if (merge.column < left) {
          left = merge.column;
          changed = true;
        }
        if (mergeRight > right) {
          right = mergeRight;
          changed = true;
        }
      }
    }

    top = this.clamp(top, 0, this.rows - 1);
    left = this.clamp(left, 0, this.columns - 1);
    bottom = this.clamp(bottom, 0, this.rows - 1);
    right = this.clamp(right, 0, this.columns - 1);

    const anchorIsTopLeft = this.selectionAnchor.row <= this.activeCell.row && this.selectionAnchor.column <= this.activeCell.column;
    const anchorIsTopRight = this.selectionAnchor.row <= this.activeCell.row && this.selectionAnchor.column >= this.activeCell.column;
    const anchorIsBottomLeft = this.selectionAnchor.row >= this.activeCell.row && this.selectionAnchor.column <= this.activeCell.column;
    const anchorIsBottomRight = this.selectionAnchor.row >= this.activeCell.row && this.selectionAnchor.column >= this.activeCell.column;

    if (anchorIsTopLeft) {
      this.selectionAnchor = { row: top, column: left };
      this.activeCell = { row: bottom, column: right };
    } else if (anchorIsBottomRight) {
      this.selectionAnchor = { row: bottom, column: right };
      this.activeCell = { row: top, column: left };
    } else if (anchorIsTopRight) {
      this.selectionAnchor = { row: top, column: right };
      this.activeCell = { row: bottom, column: left };
    } else if (anchorIsBottomLeft) {
      this.selectionAnchor = { row: bottom, column: left };
      this.activeCell = { row: top, column: right };
    } else {
      this.selectionAnchor = { row: top, column: left };
      this.activeCell = { row: bottom, column: right };
    }

    this.selectionAnchor = {
      row: this.clamp(this.selectionAnchor.row, 0, this.rows - 1),
      column: this.clamp(this.selectionAnchor.column, 0, this.columns - 1),
    };
    this.activeCell = {
      row: this.clamp(this.activeCell.row, 0, this.rows - 1),
      column: this.clamp(this.activeCell.column, 0, this.columns - 1),
    };
    this.formulaValue = this.activeCellData.value;
  }

  visibleColumns(row: number): Array<{ column: number; colspan: number; rowspan: number }> {
    const result: Array<{ column: number; colspan: number; rowspan: number }> = [];
    let column = 0;

    while (column < this.columns) {
      if (this.isMergedHidden(row, column)) {
        column += 1;
        continue;
      }

      const merge = this.mergedAt(row, column);
      const colspan = merge ? merge.columns : 1;
      const rowspan = merge ? merge.rows : 1;

      result.push({ column, colspan, rowspan });
      column += colspan;
    }

    return result;
  }

  canMergeSelection(): boolean {
    return this.selectionTop !== this.selectionBottom || this.selectionLeft !== this.selectionRight;
  }

  canUnmergeSelection(): boolean {
    return this.mergedAt(this.activeCell.row, this.activeCell.column) !== null;
  }

  mergeSelection(): void {
    if (!this.canMergeSelection()) {
      return;
    }

    this.commitRename();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    const range: MergedCell = {
      row: this.selectionTop,
      column: this.selectionLeft,
      rows: this.selectionBottom - this.selectionTop + 1,
      columns: this.selectionRight - this.selectionLeft + 1,
    };

    this.closeMenus();
    this.hideSuggestions();

    this.mergedCells = this.mergedCells.filter(merge => !this.rangesIntersect(merge, range));

    for (let row = range.row; row < range.row + range.rows; row += 1) {
      for (let column = range.column; column < range.column + range.columns; column += 1) {
        if (row === range.row && column === range.column) {
          continue;
        }

        const cell = this.cellAt(row, column);
        if (cell) {
          cell.value = '';
        }
      }
    }

    this.mergedCells.push(range);
    this.activeCell = { row: range.row, column: range.column };
    this.selectionAnchor = { ...this.activeCell };
    this.formulaValue = this.activeCellData.value;
    this.resetDisplayValues();
    this.pushHistory();
    this.sheetChange.emit();
    this.scheduleSave();
    this.scheduleRecalculate();
    this.focusGrid();
  }

  unmergeSelection(): void {
    this.commitRename();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    const merge = this.mergedAt(this.activeCell.row, this.activeCell.column);
    if (!merge) {
      return;
    }

    this.closeMenus();
    this.hideSuggestions();

    this.mergedCells = this.mergedCells.filter(item =>
      item.row !== merge.row || item.column !== merge.column
    );

    this.pushHistory();
    this.sheetChange.emit();
    this.scheduleSave();
    this.scheduleRecalculate();
    this.focusGrid();
  }

  private rangesIntersect(a: MergedCell, b: MergedCell): boolean {
    return !(
      a.row + a.rows <= b.row ||
      b.row + b.rows <= a.row ||
      a.column + a.columns <= b.column ||
      b.column + b.columns <= a.column
    );
  }

  private currentSnapshot(): SheetSnapshot {
    return {
      rows: this.rows,
      columns: this.columns,
      cells: this.cellData.map(row => row.map(cell => ({
        value: cell.value,
        style: cloneCellStyle(cell.style)
      }))),
      columnWidths: [...this.columnWidths],
      mergedCells: this.mergedCells.map(merge => ({ ...merge }))
    };
  }

  removeWorkbook(id: string): void {
    if (this.workbooks.length <= 1) {
      return;
    }

    const index = this.workbooks.findIndex(w => w.id === id);
    if (index === -1) {
      return;
    }

    const removedActive = this.activeWorkbookIndex === index;

    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();

    if (index < this.activeWorkbookIndex) {
      this.activeWorkbookIndex -= 1;
    } else if (index === this.activeWorkbookIndex) {
      this.activeWorkbookIndex = Math.max(0, this.activeWorkbookIndex - 1);
    }

    if (this.renamingWorkbookId === id) {
      this.renamingWorkbookId = null;
      this.renameValue = '';
    }

    if (this.sheetTabContextMenuTargetId === id) {
      this.closeSheetTabContextMenu();
    }

    this.workbooks = this.workbooks.filter(w => w.id !== id);

    if (removedActive) {
      const workbook = this.workbooks[this.activeWorkbookIndex];
      this.rows = workbook.snapshot.rows;
      this.columns = workbook.snapshot.columns;
      this.cellData = workbook.snapshot.cells.map(row => row.map(cell => ({
        value: cell.value,
        style: cloneCellStyle(cell.style)
      })));
      this.columnWidths = this.normalizeColumnWidths(workbook.snapshot.columnWidths, this.columns);
      this.mergedCells = workbook.snapshot.mergedCells ? workbook.snapshot.mergedCells.map(merge => ({ ...merge })) : [];
      this.rebuildIndices();
      this.activeCell = { row: 0, column: 0 };
      this.selectionAnchor = { ...this.activeCell };
      this.formulaValue = this.activeCellData.value;
      this.resetDisplayValues();
      this.history = [this.currentSnapshot()];
      this.historyIndex = 0;
      this.updateHistoryFlags();
      this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
    } else {
      this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
    }

    this.sheetChange.emit();
    this.scheduleSave();
    this.scheduleRecalculate();

    if (removedActive) {
      this.focusGrid();
    }
  }

  startRename(workbook: Workbook): void {
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.renamingWorkbookId = workbook.id;
    this.renameValue = workbook.name;

    setTimeout(() => {
      const input = document.querySelector('.sheet-tab-rename') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  }

  commitRename(): void {
    if (!this.renamingWorkbookId) {
      return;
    }

    const workbook = this.workbooks.find(item => item.id === this.renamingWorkbookId);
    let changed = false;

    if (workbook) {
      const newName = this.renameValue.trim();
      if (newName && workbook.name !== newName) {
        workbook.name = newName;
        changed = true;
      }
    }

    this.renamingWorkbookId = null;
    this.renameValue = '';

    if (changed) {
      this.sheetChange.emit();
      this.scheduleSave();
    }

    setTimeout(() => this.focusGrid());
  }

  cancelRename(): void {
    this.renamingWorkbookId = null;
    this.renameValue = '';
    setTimeout(() => this.focusGrid());
  }

  requestRemoveWorkbook(id: string): void {
    if (this.workbooks.length <= 1) {
      return;
    }

    const workbook = this.workbooks.find(item => item.id === id);
    if (!workbook) {
      return;
    }

    this.closeSheetTabContextMenu();

    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.deleteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.pendingDeleteWorkbookId = id;
    this.pendingDeleteWorkbookName = workbook.name;
    this.confirmDeleteSheetOpen = true;

    setTimeout(() => this.deleteSheetCancelRef?.nativeElement.focus({ preventScroll: true }));
  }

  cancelRemoveWorkbook(): void {
    if (!this.confirmDeleteSheetOpen) {
      return;
    }

    this.confirmDeleteSheetOpen = false;
    this.pendingDeleteWorkbookId = null;
    this.pendingDeleteWorkbookName = '';
    const target = this.deleteReturnFocus;
    this.deleteReturnFocus = null;

    if (target?.isConnected && target.getClientRects().length > 0) {
      target.focus();
    } else {
      this.focusGrid();
    }
  }

  confirmRemoveWorkbook(): void {
    if (!this.confirmDeleteSheetOpen || !this.pendingDeleteWorkbookId) {
      return;
    }

    const id = this.pendingDeleteWorkbookId;
    this.confirmDeleteSheetOpen = false;
    this.pendingDeleteWorkbookId = null;
    this.pendingDeleteWorkbookName = '';
    const target = this.deleteReturnFocus;
    this.deleteReturnFocus = null;

    this.removeWorkbook(id);

    if (target?.isConnected && target.getClientRects().length > 0) {
      target.focus();
    } else {
      this.focusGrid();
    }
  }

  duplicateWorkbook(id: string): void {
    const index = this.workbooks.findIndex(item => item.id === id);
    if (index === -1) {
      return;
    }

    this.commitRename();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.closeMenus();
    this.hideSuggestions();

    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();

    const source = this.workbooks[index];
    const clone: Workbook = {
      id: crypto.randomUUID(),
      name: source.name + ' copy',
      snapshot: {
        rows: source.snapshot.rows,
        columns: source.snapshot.columns,
        cells: source.snapshot.cells.map(row =>
          row.map(cell => ({
            value: cell.value,
            style: cloneCellStyle(cell.style)
          }))
        ),
        columnWidths: [...source.snapshot.columnWidths]
      }
    };

    const duplicatingActive = this.activeWorkbookIndex === index;
    this.workbooks.splice(index + 1, 0, clone);

    if (duplicatingActive) {
      this.activeWorkbookIndex = index + 1;
    } else if (this.activeWorkbookIndex > index) {
      this.activeWorkbookIndex += 1;
    }

    if (duplicatingActive) {
      const workbook = this.workbooks[this.activeWorkbookIndex];
      this.rows = workbook.snapshot.rows;
      this.columns = workbook.snapshot.columns;
      this.cellData = workbook.snapshot.cells.map(row => row.map(cell => ({
        value: cell.value,
        style: cloneCellStyle(cell.style)
      })));
      this.columnWidths = this.normalizeColumnWidths(workbook.snapshot.columnWidths, this.columns);
      this.mergedCells = workbook.snapshot.mergedCells ? workbook.snapshot.mergedCells.map(merge => ({ ...merge })) : [];
      this.rebuildIndices();
      this.activeCell = { row: 0, column: 0 };
      this.selectionAnchor = { row: 0, column: 0 };
      this.formulaValue = this.cellAt(0, 0).value;
      this.resetDisplayValues();
      this.history = [this.currentSnapshot()];
      this.historyIndex = 0;
      this.updateHistoryFlags();
      this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
      this.sheetChange.emit();
      this.scheduleSave();
      this.scheduleRecalculate();
      this.focusGrid();
    } else {
      this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
      this.sheetChange.emit();
      this.scheduleSave();
    }
  }

  moveWorkbook(id: string, delta: number): void {
    const index = this.workbooks.findIndex(item => item.id === id);
    if (index === -1) {
      return;
    }

    const target = index + delta;
    if (target < 0 || target >= this.workbooks.length) {
      return;
    }

    this.commitRename();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    const activeId = this.workbooks[this.activeWorkbookIndex]?.id;
    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();

    const [moved] = this.workbooks.splice(index, 1);
    this.workbooks.splice(target, 0, moved);

    const newActiveIndex = this.workbooks.findIndex(item => item.id === activeId);
    this.activeWorkbookIndex = newActiveIndex >= 0 ? newActiveIndex : this.activeWorkbookIndex;

    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
    this.sheetChange.emit();
    this.scheduleSave();
  }

  onSheetTabContextMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    event.stopPropagation();

    this.commitRename();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.closeExportMenu();
    this.closeFillDialog();
    this.closeBorderDialog();
    this.closeContextMenu();

    this.sheetTabContextMenuTargetId = id;
    this.sheetTabContextMenuX = event.clientX;
    this.sheetTabContextMenuY = event.clientY;
    this.sheetTabContextMenuOpen = true;

    setTimeout(() => {
      const menu = this.sheetTabContextMenuRef?.nativeElement;
      if (!menu) {
        return;
      }

      const rect = menu.getBoundingClientRect();
      const maxX = Math.max(8, window.innerWidth - rect.width - 8);
      const maxY = Math.max(8, window.innerHeight - rect.height - 8);

      this.sheetTabContextMenuX = Math.min(Math.max(8, this.sheetTabContextMenuX), maxX);
      this.sheetTabContextMenuY = Math.min(Math.max(8, this.sheetTabContextMenuY), maxY);
    });
  }

  closeSheetTabContextMenu(): void {
    this.sheetTabContextMenuOpen = false;
    this.sheetTabContextMenuTargetId = null;
  }

  sheetTabContextRename(): void {
    const id = this.sheetTabContextMenuTargetId;
    this.closeSheetTabContextMenu();

    if (!id) {
      return;
    }

    const workbook = this.workbooks.find(item => item.id === id);
    if (workbook) {
      this.startRename(workbook);
    }
  }

  sheetTabContextDuplicate(): void {
    const id = this.sheetTabContextMenuTargetId;
    this.closeSheetTabContextMenu();

    if (id) {
      this.duplicateWorkbook(id);
    }
  }

  sheetTabContextDelete(): void {
    const id = this.sheetTabContextMenuTargetId;
    this.closeSheetTabContextMenu();

    if (id) {
      this.requestRemoveWorkbook(id);
    }
  }

  sheetTabContextMoveLeft(): void {
    const id = this.sheetTabContextMenuTargetId;
    this.closeSheetTabContextMenu();

    if (id) {
      this.moveWorkbook(id, -1);
    }
  }

  sheetTabContextMoveRight(): void {
    const id = this.sheetTabContextMenuTargetId;
    this.closeSheetTabContextMenu();

    if (id) {
      this.moveWorkbook(id, 1);
    }
  }

  onWorkbookDragStart(event: DragEvent, index: number): void {
    if (this.renamingWorkbookId) {
      event.preventDefault();
      return;
    }

    this.draggedWorkbookIndex = index;
    this.dragOverWorkbookIndex = null;

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  onWorkbookDragOver(event: DragEvent, index: number): void {
    if (this.draggedWorkbookIndex === null) {
      return;
    }

    if (this.draggedWorkbookIndex === index) {
      event.preventDefault();
      return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    this.dragOverWorkbookIndex = index;
  }

  onWorkbookDragLeave(index: number): void {
    if (this.dragOverWorkbookIndex === index) {
      this.dragOverWorkbookIndex = null;
    }
  }

  onWorkbookDrop(event: DragEvent, targetIndex: number): void {
    event.preventDefault();

    const draggedIndex = this.draggedWorkbookIndex;
    if (draggedIndex === null || draggedIndex === targetIndex) {
      this.draggedWorkbookIndex = null;
      this.dragOverWorkbookIndex = null;
      return;
    }

    this.commitRename();
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    const activeId = this.workbooks[this.activeWorkbookIndex]?.id;
    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();

    let to = targetIndex;

    const [moved] = this.workbooks.splice(draggedIndex, 1);
    this.workbooks.splice(to, 0, moved);

    const newActiveIndex = this.workbooks.findIndex(item => item.id === activeId);
    this.activeWorkbookIndex = newActiveIndex >= 0 ? newActiveIndex : this.activeWorkbookIndex;

    this.workbooks[this.activeWorkbookIndex].snapshot = this.currentSnapshot();
    this.sheetChange.emit();
    this.scheduleSave();

    this.draggedWorkbookIndex = null;
    this.dragOverWorkbookIndex = null;
  }

  onWorkbookDragEnd(): void {
    this.draggedWorkbookIndex = null;
    this.dragOverWorkbookIndex = null;
  }

  onSheetTabsKeydown(event: KeyboardEvent): void {
    const tabs = Array.from(document.querySelectorAll('.sheet-tab:not(.sheet-tab--new)')) as HTMLElement[];
    if (tabs.length === 0) {
      return;
    }

    const currentIndex = tabs.indexOf(document.activeElement as HTMLElement);
    let nextIndex = currentIndex;

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.switchWorkbook(nextIndex, false);
    setTimeout(() => tabs[nextIndex]?.focus());
  }

  async exportCsv(): Promise<void> {
    const cells = this.cellData.map(row => row.map(cell => cell.value));
    let content: string;

    try {
      content = await this.engine.exportCsv(this.rows, this.columns, cells);
    } catch {
      content = this.fallbackCsv();
    }

    this.downloadFile(
      `\ufeff${content}`,
      exportFileName(this.documentTitle, 'csv'),
      'text/csv;charset=utf-8;'
    );
  }

  async exportXlsx(): Promise<void> {
    const cells = this.cellData.map(row => row.map(cell => cell.value));

    try {
      const content = await this.engine.exportXlsx(this.rows, this.columns, cells);
      this.downloadFile(
        content,
        exportFileName(this.documentTitle, 'xlsx'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    } catch (error) {
      console.error('Unable to export XLSX', error);
    }
  }

  private downloadFile(content: BlobPart, fileName: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  printSheet(): void {
    window.print();
  }

  openExportMenu(): void {
    if (this.confirmNewWorkbookOpen) {
      return;
    }

    const active = document.activeElement;
    this.exportReturnFocus = active instanceof HTMLElement ? active : null;
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.closeMenus();
    this.hideSuggestions();
    this.exportMenuOpen = true;
    setTimeout(() => this.exportFirstRef?.nativeElement.focus({ preventScroll: true }));
  }

  closeExportMenu(): void {
    if (!this.exportMenuOpen) {
      return;
    }

    this.exportMenuOpen = false;
    const target = this.exportReturnFocus;
    this.exportReturnFocus = null;

    if (target?.isConnected && target.getClientRects().length > 0) {
      target.focus();
    } else {
      this.focusGrid();
    }
  }

  @HostListener('document:keydown.escape')
  closeDialogOnEscape(): void {
    if (this.confirmNewWorkbookOpen) {
      this.cancelNewSheet();
      return;
    }

    if (this.contextMenuOpen) {
      this.closeContextMenu();
      this.focusGrid();
      return;
    }

    this.closeExportMenu();
  }

  @HostListener('window:resize')
  closeContextMenuOnResize(): void {
    this.closeContextMenu();
  }

  @HostListener('document:keydown', ['$event'])
  trapDialogFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }

    let dialog: HTMLElement | undefined;

    if (this.confirmNewWorkbookOpen) {
      dialog = this.newSheetDialogRef?.nativeElement;
    } else if (this.exportMenuOpen) {
      dialog = this.exportDialogRef?.nativeElement;
    }

    if (!dialog) {
      return;
    }

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(element => element.getClientRects().length > 0);

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  saveAsCsv(): void {
    this.closeExportMenu();
    void this.exportCsv();
  }

  saveAsXlsx(): void {
    this.closeExportMenu();
    void this.exportXlsx();
  }

  saveAsPdf(): void {
    this.closeExportMenu();
    setTimeout(() => this.printSheet());
  }

  closeMenus(): void {
    this.menuRefs?.forEach(menu => menu.nativeElement.open = false);
  }

  commitFormula(event?: Event): void {
    if (event) {
      event.preventDefault();
    }

    const cell = this.activeCellData;
    const value = normalizeFormula(this.formulaValue);
    this.selectionAnchor = { ...this.activeCell };
    if (cell.value !== value) {
      cell.value = value;
      this.cellChange.emit({
        row: this.activeCell.row,
        column: this.activeCell.column,
        value
      });
      this.pushHistory();
    }

    this.hideSuggestions();
    this.referenceInsertion = null;

    if (event) {
      this.formulaSource = null;
      this.moveSelection('down');
      this.formulaInputRef?.nativeElement.blur();
    } else {
      this.formulaValue = cell.value;
    }
  }

  private escapeCsv(value: string): string {
    const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replace(/"/g, '""')}"`;
  }

  private fallbackCsv(): string {
    const values = this.rowIndices.map(row =>
      this.columnIndices.map(column => this.displayAt(row, column))
    );

    return trimToUsedRange(values)
      .map(row => row.map(value => this.escapeCsv(value)).join(','))
      .join('\r\n');
  }

  private pushHistory(): void {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.takeSnapshot());

    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }

    this.historyIndex = this.history.length - 1;
    this.updateHistoryFlags();
    
    // Sync the active workbook's snapshot
    this.workbooks[this.activeWorkbookIndex].snapshot = this.takeSnapshot();
    
    this.sheetChange.emit();
    this.scheduleSave();
    this.scheduleRecalculate();
  }

  private updateHistoryFlags(): void {
    this.canUndo = this.historyIndex > 0;
    this.canRedo = this.historyIndex < this.history.length - 1;
  }

  private takeSnapshot(): SheetSnapshot {
    return this.currentSnapshot();
  }

  private restoreSnapshot(snapshot: SheetSnapshot): void {
    this.rows = snapshot.rows;
    this.columns = snapshot.columns;
    this.cellData = snapshot.cells.map(row => row.map(cell => ({
      value: cell.value,
      style: cloneCellStyle(cell.style)
    })));
    this.columnWidths = this.normalizeColumnWidths(snapshot.columnWidths, this.columns);
    this.mergedCells = snapshot.mergedCells ? snapshot.mergedCells.map(merge => ({ ...merge })) : [];
    this.rebuildIndices();
    this.activeCell = {
      row: this.clamp(this.activeCell.row, 0, this.rows - 1),
      column: this.clamp(this.activeCell.column, 0, this.columns - 1)
    };
    this.selectionAnchor = { ...this.activeCell };
    this.formulaValue = this.activeCellData.value;
    this.resetDisplayValues();
  }

  private rebuildIndices(): void {
    this.rowIndices = Array.from({ length: this.rows }, (_, index) => index);
    this.columnIndices = Array.from({ length: this.columns }, (_, index) => index);
  }

  private createCells(rows: number, columns: number): Cell[][] {
    return Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => this.createCell())
    );
  }

  private createCell(): Cell {
    return { value: '', style: cloneCellStyle(DEFAULT_CELL_STYLE) };
  }

  private normalizeCell(raw: unknown): Cell {
    const source = (raw ?? {}) as Partial<Cell>;
    const style = (source.style ?? {}) as Partial<CellStyle>;

    return {
      value: typeof source.value === 'string' ? source.value : '',
      style: {
        bold: style.bold === true,
        italic: style.italic === true,
        underline: style.underline === true,
        strike: style.strike === true,
        align: style.align === 'center' || style.align === 'right' ? style.align : 'left',
         background: normalizeColor(style.background),
         color: normalizeColor(style.color),
         borders: normalizeCellBorders(style.borders)
      }
    };
  }

  private normalizeColumnWidths(raw: unknown, columns: number): number[] {
    const source = Array.isArray(raw) ? raw : [];

    return Array.from({ length: columns }, (_, index) => {
      const width = source[index];
      return typeof width === 'number' && Number.isFinite(width)
        ? this.clamp(Math.round(width), MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH)
        : DEFAULT_COLUMN_WIDTH;
    });
  }

  private restore(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return false;
      }

      const data = JSON.parse(raw) as { workbooks: Workbook[]; activeIndex: number };
      if (
        !Array.isArray(data.workbooks) ||
        data.workbooks.length === 0 ||
        !Number.isInteger(data.activeIndex) ||
        data.activeIndex < 0 ||
        data.activeIndex >= data.workbooks.length
      ) {
        return false;
      }

      this.workbooks = data.workbooks;
      this.activeWorkbookIndex = data.activeIndex;
      
      const workbook = this.workbooks[this.activeWorkbookIndex];
      this.rows = workbook.snapshot.rows;
      this.columns = workbook.snapshot.columns;
      this.cellData = workbook.snapshot.cells.map(row => row.map(cell => ({
        value: cell.value,
        style: cloneCellStyle(cell.style)
      })));
      this.columnWidths = this.normalizeColumnWidths(workbook.snapshot.columnWidths, this.columns);
      this.mergedCells = workbook.snapshot.mergedCells ? workbook.snapshot.mergedCells.map(merge => ({ ...merge })) : [];
      this.rebuildIndices();
      this.activeCell = {
        row: this.clamp(this.activeCell.row, 0, this.rows - 1),
        column: this.clamp(this.activeCell.column, 0, this.columns - 1)
      };
      this.selectionAnchor = { ...this.activeCell };
      this.formulaValue = this.activeCellData.value;
      this.resetDisplayValues();
      return true;
    } catch {
      return false;
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.persist();
    }, 400);
  }

  private persist(): void {
    try {
      const data = {
        workbooks: this.workbooks.map(w => ({
          id: w.id,
          name: w.name,
          snapshot: {
            rows: w.snapshot.rows,
            columns: w.snapshot.columns,
            cells: w.snapshot.cells.map(row =>
              row.map(cell => ({
                value: cell.value,
                style: cloneCellStyle(cell.style)
              }))
            ),
            columnWidths: [...w.snapshot.columnWidths],
            mergedCells: (w.snapshot.mergedCells ?? []).map(merge => ({ ...merge }))
          }
        })),
        activeIndex: this.activeWorkbookIndex
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.saved.emit();
    } catch {
      return;
    }
  }

  private resetDisplayValues(): void {
    this.displayValues = this.cellData.map(row => row.map(cell => cell.value));
  }

  private scheduleRecalculate(): void {
    this.recalculateVersion += 1;

    if (this.recalculateTimer) {
      clearTimeout(this.recalculateTimer);
    }

    this.recalculateTimer = setTimeout(() => void this.recalculate(), 40);
  }

  private async recalculate(): Promise<void> {
    const version = this.recalculateVersion;
    const rows = this.rows;
    const columns = this.columns;
    const cells = this.cellData.map(row => row.map(cell => cell.value));

    if (!cells.some(row => row.some(value => value.trimStart().startsWith('=')))) {
      if (version === this.recalculateVersion) {
        this.displayValues = cells;
      }
      return;
    }

    try {
      const values = await this.engine.evaluate(rows, columns, cells);
      if (version === this.recalculateVersion) {
        this.displayValues = values;
      }
    } catch {
      if (version === this.recalculateVersion) {
        this.displayValues = cells;
      }
    }
  }

  private focusGrid(): void {
    setTimeout(() => this.gridRef?.nativeElement.focus({ preventScroll: true }));
  }

  private finishContextAction(): void {
    this.closeContextMenu();
    this.focusGrid();
  }

  private focusContextMenuItem(): void {
    this.contextMenuItems()[0]?.focus();
  }

  private moveContextMenuFocus(delta: number): void {
    const items = this.openSubmenu
      ? this.contextSubmenuItems()
      : this.contextMenuItems();
    if (!items.length) {
      return;
    }

    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  private contextMenuItems(): HTMLButtonElement[] {
    return this.menuItems(this.contextMenuElement ?? undefined);
  }

  private contextSubmenuItems(): HTMLButtonElement[] {
    return this.menuItems(this.contextSubmenuRef?.nativeElement);
  }

  private menuItems(element: HTMLElement | undefined): HTMLButtonElement[] {
    if (!element) {
      return [];
    }

    return Array.from(element.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
  }

  private selectionValues(): string[][] {
    const values: string[][] = [];

    for (let row = this.selectionTop; row <= this.selectionBottom; row += 1) {
      const line: string[] = [];

      for (let column = this.selectionLeft; column <= this.selectionRight; column += 1) {
        line.push(this.cellAt(row, column).value);
      }

      values.push(line);
    }

    return values;
  }

  private selectionDisplayValues(): string[][] {
    const values: string[][] = [];

    for (let row = this.selectionTop; row <= this.selectionBottom; row += 1) {
      const line: string[] = [];

      for (let column = this.selectionLeft; column <= this.selectionRight; column += 1) {
        line.push(this.displayAt(row, column));
      }

      values.push(line);
    }

    return values;
  }

  private positionContextMenu(): void {
    const element = this.contextMenuElement;
    if (!element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(this.contextMenuClientX, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(this.contextMenuClientY, window.innerHeight - rect.height - 8));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  private positionSubmenu(): void {
    const submenu = this.submenuElement;
    const trigger = this.submenuTrigger;

    if (!submenu || !trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const width = submenu.offsetWidth;
    const height = submenu.offsetHeight;
    let left = rect.right - 4;

    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, rect.left - width + 4);
    }

    let top = rect.top - 5;

    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - height - 8);
    }

    submenu.style.left = `${left}px`;
    submenu.style.top = `${top}px`;
  }

  private selectionText(): string {
    const lines: string[] = [];

    for (let row = this.selectionTop; row <= this.selectionBottom; row += 1) {
      const line: string[] = [];

      for (let column = this.selectionLeft; column <= this.selectionRight; column += 1) {
        line.push(this.displayAt(row, column));
      }

      lines.push(line.join('\t'));
    }

    return lines.join('\n');
  }

  private writeSystemClipboard(): void {
    const text = this.selectionText();

    try {
      void navigator.clipboard?.writeText(text)?.catch(() => undefined);
    } catch {
      return;
    }
  }

  private async readSystemClipboard(): Promise<string[][] | null> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        return null;
      }

      return text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.split('\t'));
    } catch {
      return null;
    }
  }

  private pasteValues(values: string[][]): void {
    const targetRow = this.activeCell.row;
    const targetColumn = this.activeCell.column;
    const width = values.reduce((max, row) => Math.max(max, row.length), 0);
    const rowsBefore = this.rows;
    const columnsBefore = this.columns;
    this.ensureCapacity(targetRow + values.length, targetColumn + width);
    const dimensionsChanged = this.rows !== rowsBefore || this.columns !== columnsBefore;
    let changed = dimensionsChanged;

    for (let row = 0; row < values.length; row += 1) {
      for (let column = 0; column < values[row].length; column += 1) {
        const cell = this.cellAt(targetRow + row, targetColumn + column);
        if (cell.value !== values[row][column]) {
          cell.value = values[row][column];
          changed = true;
        }
      }
    }

    if (!changed) {
      return;
    }

    this.formulaValue = this.activeCellData.value;
    this.pushHistory();
  }

  private clearRange(origin: Selection, values: string[][]): boolean {
    let cleared = false;

    for (let row = 0; row < values.length; row += 1) {
      for (let column = 0; column < values[row].length; column += 1) {
        const cell = this.cellData[origin.row + row]?.[origin.column + column];
        if (cell && cell.value !== '') {
          cell.value = '';
          cleared = true;
        }
      }
    }

    return cleared;
  }

  private ensureCapacity(rows: number, columns: number): void {
    let changed = false;

    while (this.rows < rows) {
      this.rows += 1;
      this.cellData.push(Array.from({ length: this.columns }, () => this.createCell()));
      changed = true;
    }

    while (this.columns < columns) {
      this.columns += 1;
      this.columnWidths.push(DEFAULT_COLUMN_WIDTH);
      this.cellData.forEach(row => row.push(this.createCell()));
      changed = true;
    }

    if (changed) {
      this.rebuildIndices();
    }
  }

  private beginStyleDialog(): HTMLElement | null {
    const active = document.activeElement;
    const target = active instanceof HTMLElement ? active : null;
    this.commitEdit('none', false);

    if (this.formulaSource === 'formula') {
      this.commitFormula();
    }

    this.closeMenus();
    this.hideSuggestions();
    return target;
  }

  private restoreDialogFocus(target: HTMLElement | null): void {
    if (target?.isConnected && target.getClientRects().length > 0) {
      target.focus();
    } else {
      this.focusGrid();
    }
  }

  private handleStyleDialogKeydown(
    event: KeyboardEvent,
    dialog: HTMLElement | undefined,
    close: () => void
  ): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab' || !dialog) {
      return;
    }

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')
    ).filter(element => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!first || !last) {
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => {
      const selector = `[data-row="${this.activeCell.row}"][data-col="${this.activeCell.column}"]`;
      const target = this.gridRef?.nativeElement.querySelector<HTMLElement>(selector);
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private stepCell(row: number, column: number, direction: 'up' | 'down' | 'left' | 'right'): Selection {
    const currentMerge = this.mergedAt(row, column);
    let nextRow = row;
    let nextColumn = column;

    if (direction === 'up') {
      nextRow -= 1;
    } else if (direction === 'down') {
      nextRow += 1;
    } else if (direction === 'left') {
      nextColumn -= 1;
    } else {
      nextColumn += 1;
    }

    let guard = 0;
    while (
      guard < this.rows + this.columns + 10 &&
      nextRow >= 0 &&
      nextRow < this.rows &&
      nextColumn >= 0 &&
      nextColumn < this.columns
    ) {
      const candidateMerge = this.mergedAt(nextRow, nextColumn);

      if (!candidateMerge) {
        break;
      }

      const sameMerge =
        currentMerge !== null &&
        candidateMerge.row === currentMerge.row &&
        candidateMerge.column === currentMerge.column;

      if (sameMerge) {
        if (direction === 'up') {
          nextRow = candidateMerge.row - 1;
        } else if (direction === 'down') {
          nextRow = candidateMerge.row + candidateMerge.rows;
        } else if (direction === 'left') {
          nextColumn = candidateMerge.column - 1;
        } else {
          nextColumn = candidateMerge.column + candidateMerge.columns;
        }
        guard += 1;
        continue;
      }

      nextRow = candidateMerge.row;
      nextColumn = candidateMerge.column;
      break;
    }

    nextRow = this.clamp(nextRow, 0, this.rows - 1);
    nextColumn = this.clamp(nextColumn, 0, this.columns - 1);
    return { row: nextRow, column: nextColumn };
  }

  private clampSelection(row: number, column: number): Selection {
    return {
      row: this.clamp(row, 0, this.rows - 1),
      column: this.clamp(column, 0, this.columns - 1)
    };
  }

  private forEachSelectedCell(callback: (cell: Cell, row: number, column: number) => void): void {
    for (let row = this.selectionTop; row <= this.selectionBottom; row += 1) {
      for (let column = this.selectionLeft; column <= this.selectionRight; column += 1) {
        callback(this.cellAt(row, column), row, column);
      }
    }
  }

  private formatNumber(value: number): string {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}
