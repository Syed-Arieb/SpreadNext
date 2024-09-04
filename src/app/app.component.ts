import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { freeSet } from '@coreui/icons';
import { SpreadsheetComponent } from "./spreadsheet/spreadsheet.component";

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SpreadsheetComponent],
  templateUrl: './app.component.html',
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
