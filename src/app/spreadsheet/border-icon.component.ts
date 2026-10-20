import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { BorderPreset } from './cell-borders';

@Component({
  selector: 'app-border-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (preset) {
        @case ('all') {
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 12h18M12 3v18" />
        }
        @case ('outer') {
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path class="ghost" d="M3 12h18M12 3v18" />
        }
        @case ('inner') {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 12h18M12 3v18" />
        }
        @case ('horizontal') {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path class="ghost" d="M12 3v18" />
          <path d="M3 12h18" />
        }
        @case ('vertical') {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path class="ghost" d="M3 12h18" />
          <path d="M12 3v18" />
        }
        @case ('top') {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path class="ghost" d="M3 12h18M12 3v18" />
          <path d="M3 3h18" />
        }
        @case ('right') {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path class="ghost" d="M3 12h18M12 3v18" />
          <path d="M21 3v18" />
        }
        @case ('bottom') {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path class="ghost" d="M3 12h18M12 3v18" />
          <path d="M3 21h18" />
        }
        @case ('left') {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path class="ghost" d="M3 12h18M12 3v18" />
          <path d="M3 3v18" />
        }
        @case ('diagonalDown') {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 3l18 18" />
        }
        @case ('diagonalUp') {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 21L21 3" />
        }
        @default {
          <rect class="ghost" x="3" y="3" width="18" height="18" rx="2" />
          <path class="ghost" d="M3 12h18M12 3v18" />
        }
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      svg {
        width: 100%;
        height: 100%;
      }

      .ghost {
        opacity: 0.28;
      }
    `
  ]
})
export class BorderIconComponent {
  @Input() preset: BorderPreset = 'all';
}
