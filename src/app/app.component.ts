import { ChangeDetectionStrategy, Component, HostListener, ViewChild } from '@angular/core';
import { cilMoon, cilSpreadsheet, cilSun } from '@coreui/icons';
import { IconDirective } from '@coreui/icons-angular';
import { SpreadsheetComponent } from './spreadsheet/spreadsheet.component';

@Component({
  selector: 'app-root',
  imports: [SpreadsheetComponent, IconDirective],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.css'
})
export class AppComponent {
  readonly title = 'SpreadNext';
  readonly icons = { cilMoon, cilSpreadsheet, cilSun };

  documentTitle = 'Untitled spreadsheet';
  unsavedChanges = false;
  darkMode = true;

  private titleSaveTimer?: ReturnType<typeof setTimeout>;

  @ViewChild(SpreadsheetComponent) private sheetRef?: SpreadsheetComponent;

  constructor() {
    const savedTitle = this.readStorage('spreadnext-title');
    if (savedTitle) {
      this.documentTitle = savedTitle;
    }
    this.updateDocumentTitle();

    const theme = document.documentElement.dataset['theme'];
    this.darkMode = theme
      ? theme === 'dark'
      : !window.matchMedia('(prefers-color-scheme: light)').matches;
    this.applyTheme();
  }

  onTitleInput(event: Event): void {
    this.documentTitle = (event.target as HTMLInputElement).value;
    this.unsavedChanges = true;
    this.updateDocumentTitle();

    if (this.titleSaveTimer) {
      clearTimeout(this.titleSaveTimer);
    }

    this.titleSaveTimer = setTimeout(() => {
      this.titleSaveTimer = undefined;
      if (!this.persistTitle()) {
        return;
      }
      this.unsavedChanges = false;
    }, 600);
  }

  onTitleFocus(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    setTimeout(() => {
      if (document.activeElement === input) {
        input.select();
      }
    });
  }

  onTitleReset(): void {
    if (this.titleSaveTimer) {
      clearTimeout(this.titleSaveTimer);
      this.titleSaveTimer = undefined;
    }

    this.documentTitle = 'Untitled spreadsheet';
    this.unsavedChanges = true;
    this.updateDocumentTitle();
    this.persistTitle();
  }

  onCellChange(): void {
    this.unsavedChanges = true;
  }

  onSheetChange(): void {
    this.unsavedChanges = true;
  }

  onSaved(): void {
    this.unsavedChanges = false;
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey) {
      return;
    }

    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') {
      return;
    }

    event.preventDefault();
    this.sheetRef?.openExportMenu();
  }

  toggleTheme(): void {
    this.darkMode = !this.darkMode;
    this.applyTheme();

    try {
      localStorage.setItem('spreadnext-theme', this.darkMode ? 'dark' : 'light');
    } catch {
      return;
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeunload(event: BeforeUnloadEvent): string | undefined {
    if (!this.unsavedChanges) {
      return undefined;
    }

    event.preventDefault();
    event.returnValue = 'Your changes will be lost!';
    return 'Your changes will be lost!';
  }

  private applyTheme(): void {
    document.documentElement.dataset['theme'] = this.darkMode ? 'dark' : 'light';
  }

  private updateDocumentTitle(): void {
    document.title = `${this.title} - ${this.documentTitle.trim() || 'Untitled spreadsheet'}`;
  }

  private persistTitle(): boolean {
    try {
      localStorage.setItem('spreadnext-title', this.documentTitle);
      return true;
    } catch {
      return false;
    }
  }

  private readStorage(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}
