import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { liveList, tr } from '../../../shared/i18n/lang';

export interface HeatmapCell {
  /** Monday=0 … Sunday=6 (matches the API's slotDow). */
  dow: number;
  /** Facility-local hour 0–23. */
  hour: number;
  count: number;
}

// RAW Georgian behind `liveList`: each indexed read runs through `tr()`, so the
// grid relabels itself on a language flip instead of baking at import time.
const DAY_LABELS = liveList(['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვი']);
const DAY_FULL = liveList([
  'ორშაბათი',
  'სამშაბათი',
  'ოთხშაბათი',
  'ხუთშაბათი',
  'პარასკევი',
  'შაბათი',
  'კვირა',
]);

/**
 * 7×24 peak/dead-hours grid (spec metric 2): color intensity = booking
 * volume, native title tooltip with the exact count. Hours outside the data
 * are trimmed to a sensible window (min 08:00–23:00 shown) to keep cells
 * readable; the full grid scrolls horizontally on narrow screens.
 */
@Component({
  selector: 'ss-heatmap-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="grid" [style.--cols]="hours().length">
        <span class="corner"></span>
        @for (hour of hours(); track hour) {
          <span class="hour ss-num">{{ hour }}</span>
        }
        @for (dow of DOWS; track dow) {
          <span class="day georgian-text" lang="ka">{{ dayLabel(dow) }}</span>
          @for (hour of hours(); track hour) {
            <span
              class="cell"
              [style.background]="cellColor(dow, hour)"
              [title]="cellTitle(dow, hour)"
            ></span>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .wrap {
        overflow-x: auto;
        padding-bottom: 4px;
      }
      .grid {
        display: grid;
        grid-template-columns: 44px repeat(var(--cols), minmax(22px, 1fr));
        gap: 3px;
        min-width: 560px;
      }
      .corner {
      }
      .hour {
        font-size: 10px;
        color: var(--text-faint);
        text-align: center;
        align-self: end;
      }
      .day {
        font-size: 11px;
        color: var(--text-muted);
        align-self: center;
        white-space: nowrap;
      }
      .cell {
        aspect-ratio: 1 / 1;
        border-radius: 5px;
        min-height: 20px;
      }
    `,
  ],
})
export class HeatmapGridComponent {
  readonly cells = input.required<HeatmapCell[]>();
  readonly max = input.required<number>();

  readonly DOWS = [0, 1, 2, 3, 4, 5, 6];

  private readonly byKey = computed(() => {
    const map = new Map<string, number>();
    for (const cell of this.cells()) {
      map.set(`${cell.dow}:${cell.hour}`, cell.count);
    }
    return map;
  });

  /** Hour window: at least 08–23, widened to include any out-of-window data. */
  readonly hours = computed(() => {
    let first = 8;
    let last = 23;
    for (const cell of this.cells()) {
      first = Math.min(first, cell.hour);
      last = Math.max(last, cell.hour);
    }
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  });

  dayLabel(dow: number): string {
    return DAY_LABELS[dow];
  }

  countAt(dow: number, hour: number): number {
    return this.byKey().get(`${dow}:${hour}`) ?? 0;
  }

  cellColor(dow: number, hour: number): string {
    const count = this.countAt(dow, hour);
    if (count === 0 || this.max() === 0) {
      return 'var(--tui-background-neutral-1)';
    }
    const alpha = 0.15 + 0.85 * (count / this.max());
    return `rgba(124, 108, 246, ${alpha.toFixed(3)})`;
  }

  cellTitle(dow: number, hour: number): string {
    const count = this.countAt(dow, hour);
    return `${DAY_FULL[dow]} · ${String(hour).padStart(2, '0')}:00 — ${count} ${tr('ჯავშანი')}`;
  }
}
