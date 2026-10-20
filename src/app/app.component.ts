import { Component, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { freeSet } from '@coreui/icons';
import { SpreadsheetComponent } from "./spreadsheet/spreadsheet.component";

@Component({
    selector: 'app-root',
    imports: [SpreadsheetComponent],
    templateUrl: './app.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'SpreadNext';
  icons = freeSet;
  unsavedChanges = false;

  @HostListener('window:beforeunload', ['$event'])
  beforeunload(event: BeforeUnloadEvent) {
    if (!this.unsavedChanges) {
      return undefined;
    }
    event.preventDefault();
    event.returnValue = 'Your changes will be lost!';
    return 'Your changes will be lost!';
  }

  onCellChange(event: { row: number, column: number, value: string }) {
    this.unsavedChanges = true;
  }
}
