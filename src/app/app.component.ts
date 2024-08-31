import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { freeSet } from '@coreui/icons';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'SpreadNext';
  icons = freeSet ;
}
