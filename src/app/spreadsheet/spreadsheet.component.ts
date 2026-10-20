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
import {
  cilActionRedo,
  cilActionUndo,
  cilAlignCenter,
  cilAlignLeft,
  cilAlignRight,
  cilArrowRight,
  cilBold,
  cilBorderAll,
  cilBorderBottom,
  cilBorderClear,
  cilBorderHorizontal,
  cilBorderInner,
  cilBorderLeft,
  cilBorderOuter,
  cilBorderRight,
  cilBorderTop,
  cilBorderVertical,
  cilBrushAlt,
  cilCheck,
  cilCloudDownload,
  cilColorFill,
  cilDescription,
  cilGrid,
  cilGridSlash,
  cilItalic,
  cilPlus,
  cilPrint,
  cilSave,
  cilShortText,
  cilSpreadsheet,
  cilSquare,
  cilStrikethrough,
  cilTrash,
  cilUnderline,
  cilX
} from '@coreui/icons';
import { IconDirective } from '@coreui/icons-angular';
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
}

type MoveDirection = 'up' | 'down' | 'left' | 'right' | 'none';

const DEFAULT_ROWS = 24;
const DEFAULT_COLUMNS = 16;
const DEFAULT_COLUMN_WIDTH = 128;
const MIN_COLUMN_WIDTH = 56;
const MAX_COLUMN_WIDTH = 480;
const ROW_HEADER_WIDTH = 48;
const MAX_HISTORY = 100;
const STORAGE_KEY = 'spreadnext-sheet';
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
  imports: [IconDirective],
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

  readonly icons = {
    cilActionRedo,
    cilActionUndo,
    cilAlignCenter,
    cilAlignLeft,
    cilAlignRight,
    cilArrowRight,
    cilBold,
    cilBorderAll,
    cilBrushAlt,
    cilCheck,
    cilCloudDownload,
    cilColorFill,
    cilDescription,
    cilGrid,
    cilGridSlash,
    cilItalic,
    cilPlus,
    cilPrint,
    cilSave,
    cilShortText,
    cilSpreadsheet,
    cilSquare,
    cilStrikethrough,
    cilTrash,
    cilUnderline,
    cilX
  };

  readonly fillColors = FILL_COLORS;
  readonly borderLineStyles: { value: BorderLineStyle; label: string }[] = [
    { value: 'thin', label: 'Thin' },
    { value: 'medium', label: 'Medium' },
    { value: 'thick', label: 'Thick' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
    { value: 'double', label: 'Double' }
  ];
  readonly borderPresets: { id: BorderPreset; label: string; icon?: string[] }[] = [
    { id: 'all', label: 'All', icon: cilBorderAll },
    { id: 'outer', label: 'Outer', icon: cilBorderOuter },
    { id: 'inner', label: 'Inner', icon: cilBorderInner },
    { id: 'horizontal', label: 'Horizontal', icon: cilBorderHorizontal },
    { id: 'vertical', label: 'Vertical', icon: cilBorderVertical },
    { id: 'top', label: 'Top', icon: cilBorderTop },
    { id: 'right', label: 'Right', icon: cilBorderRight },
    { id: 'bottom', label: 'Bottom', icon: cilBorderBottom },
    { id: 'left', label: 'Left', icon: cilBorderLeft },
    { id: 'diagonalDown', label: 'Diagonal' },
    { id: 'diagonalUp', label: 'Diagonal up' },
    { id: 'none', label: 'None', icon: cilBorderClear }
  ];

  cellData: Cell[][] = [];
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
  confirmNewSheetOpen = false;
  fillDialogOpen = false;
  borderDialogOpen = false;
  fillPickerValue = '#fde047';
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
  private fillReturnFocus: HTMLElement | null = null;
  private borderReturnFocus: HTMLElement | null = null;

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
  @ViewChild('newSheetDialog') private newSheetDialogRef?: ElementRef<HTMLElement>;
  @ViewChild('fillFirst') private fillFirstRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('fillDialog') private fillDialogRef?: ElementRef<HTMLElement>;
  @ViewChild('borderFirst') private borderFirstRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('borderDialog') private borderDialogRef?: ElementRef<HTMLElement>;
  @ViewChildren('menu') private menuRefs?: QueryList<ElementRef<HTMLDetailsElement>>;

  private history: SheetSnapshot[] = [];
  private historyIndex = -1;
  private saveTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    if (!this.restore()) {
      this.rows = Math.max(1, this.rows);
      this.columns = Math.max(1, this.columns);
      this.cellData = this.createCells(this.rows, this.columns);
    }

    this.rebuildIndices();
    this.columnWidths = this.normalizeColumnWidths(this.columnWidths, this.columns);
    this.activeCell = { row: 0, column: 0 };
    this.formulaValue = this.cellAt(0, 0).value;
    this.resetDisplayValues();
    this.history = [this.takeSnapshot()];
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
    const background = this.cellAt(row, column).style.background;
    if (!background || this.displayAt(row, column).startsWith('#')) {
      return null;
    }

    return contrastTextColor(background);
  }

  cellAt(row: number, column: number): Cell {
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
      }
    }

    switch (key) {
      case 'ArrowUp':
        event.preventDefault();
        this.moveSelection('up');
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.moveSelection('down');
        return;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveSelection('left');
        return;
      case 'ArrowRight':
        event.preventDefault();
        this.moveSelection('right');
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
    let row = this.activeCell.row;
    let column = this.activeCell.column;

    if (direction === 'up') {
      row -= 1;
    } else if (direction === 'down') {
      row += 1;
    } else if (direction === 'left') {
      column -= 1;
    } else {
      column += 1;
    }

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
    if (this.fillDialogOpen || this.borderDialogOpen || this.confirmNewSheetOpen || this.exportMenuOpen) {
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

  openBorderDialog(): void {
    if (this.fillDialogOpen || this.borderDialogOpen || this.confirmNewSheetOpen || this.exportMenuOpen) {
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
    this.updateHistoryFlags();
    this.sheetChange.emit();
    this.scheduleSave();
    this.scheduleRecalculate();
    this.focusGrid();
  }

  requestNewSheet(): void {
    if (this.confirmNewSheetOpen || this.exportMenuOpen) {
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
    this.confirmNewSheetOpen = true;
    setTimeout(() => this.newSheetCancelRef?.nativeElement.focus({ preventScroll: true }));
  }

  cancelNewSheet(): void {
    if (!this.confirmNewSheetOpen) {
      return;
    }

    this.confirmNewSheetOpen = false;
    const target = this.newSheetReturnFocus;
    this.newSheetReturnFocus = null;

    if (target?.isConnected && target.getClientRects().length > 0) {
      target.focus();
    } else {
      this.focusGrid();
    }
  }

  confirmNewSheet(): void {
    if (!this.confirmNewSheetOpen) {
      return;
    }

    this.confirmNewSheetOpen = false;
    this.newSheetReturnFocus = null;
    this.commitEdit('none', false);
    this.rows = DEFAULT_ROWS;
    this.columns = DEFAULT_COLUMNS;
    this.cellData = this.createCells(this.rows, this.columns);
    this.columnWidths = this.normalizeColumnWidths([], this.columns);
    this.rebuildIndices();
    this.activeCell = { row: 0, column: 0 };
    this.selectionAnchor = { row: 0, column: 0 };
    this.formulaValue = '';
    this.resetDisplayValues();
    this.pushHistory();
    this.titleReset.emit();
    this.focusGrid();
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
    if (this.confirmNewSheetOpen) {
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
    if (this.confirmNewSheetOpen) {
      this.cancelNewSheet();
      return;
    }

    this.closeExportMenu();
  }

  @HostListener('document:keydown', ['$event'])
  trapDialogFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }

    let dialog: HTMLElement | undefined;

    if (this.confirmNewSheetOpen) {
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
    return this.rowIndices
      .map(row => this.columnIndices
        .map(column => this.escapeCsv(this.displayAt(row, column)))
        .join(','))
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
    this.sheetChange.emit();
    this.scheduleSave();
    this.scheduleRecalculate();
  }

  private updateHistoryFlags(): void {
    this.canUndo = this.historyIndex > 0;
    this.canRedo = this.historyIndex < this.history.length - 1;
  }

  private takeSnapshot(): SheetSnapshot {
    return {
      rows: this.rows,
      columns: this.columns,
      cells: this.cellData.map(row => row.map(cell => ({
        value: cell.value,
        style: cloneCellStyle(cell.style)
      }))),
      columnWidths: [...this.columnWidths]
    };
  }

  private restoreSnapshot(snapshot: SheetSnapshot): void {
    this.rows = snapshot.rows;
    this.columns = snapshot.columns;
    this.cellData = snapshot.cells.map(row => row.map(cell => ({
      value: cell.value,
      style: cloneCellStyle(cell.style)
    })));
    this.columnWidths = this.normalizeColumnWidths(snapshot.columnWidths, this.columns);
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

      const data = JSON.parse(raw) as Partial<SheetSnapshot>;
      if (
        !Number.isInteger(data.rows) ||
        !Number.isInteger(data.columns) ||
        (data.rows ?? 0) < 1 ||
        (data.columns ?? 0) < 1 ||
        !Array.isArray(data.cells)
      ) {
        return false;
      }

      this.rows = Math.min(500, data.rows as number);
      this.columns = Math.min(100, data.columns as number);
      this.cellData = Array.from({ length: this.rows }, (_, row) =>
        Array.from({ length: this.columns }, (_, column) =>
          this.normalizeCell(data.cells?.[row]?.[column])
        )
      );
      this.columnWidths = this.normalizeColumnWidths(data.columnWidths, this.columns);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.takeSnapshot()));
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
      this.gridRef?.nativeElement
        .querySelector<HTMLElement>(selector)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
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
