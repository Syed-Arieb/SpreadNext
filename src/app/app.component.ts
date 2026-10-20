import { ChangeDetectionStrategy, Component, HostListener } from '@angular/core';
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
      try {
        localStorage.setItem('spreadnext-title', this.documentTitle);
      } catch {
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

  private readStorage(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}
