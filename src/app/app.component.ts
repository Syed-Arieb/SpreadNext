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

    const theme = document.documentElement.dataset['theme'];
    this.darkMode = theme
      ? theme === 'dark'
      : !window.matchMedia('(prefers-color-scheme: light)').matches;
    this.applyTheme();
  }

  onTitleInput(event: Event): void {
    this.documentTitle = (event.target as HTMLInputElement).value;
    this.unsavedChanges = true;

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
    this.saveNow();
  }

  saveNow(): void {
    if (this.titleSaveTimer) {
      clearTimeout(this.titleSaveTimer);
      this.titleSaveTimer = undefined;
      this.persistTitle();
    }

    this.sheetRef?.saveNow();
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
