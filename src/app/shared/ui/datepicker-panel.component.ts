import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { liveList, tr } from '../i18n/lang';
import { TPipe } from '../i18n/t.pipe';
import { SS_DATEPICKER_TRIGGER, SsDatepickerService } from './datepicker.service';

// RAW Georgian; `liveList` translates each indexed read on the fly.
const MONTHS_KA = liveList([
  'იანვარი',
  'თებერვალი',
  'მარტი',
  'აპრილი',
  'მაისი',
  'ივნისი',
  'ივლისი',
  'აგვისტო',
  'სექტემბერი',
  'ოქტომბერი',
  'ნოემბერი',
  'დეკემბერი',
]);

const WEEKDAYS_KA = liveList(['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვი']);

interface DayCell {
  iso: string;
  num: number;
  out: boolean;
  today: boolean;
  selected: boolean;
  disabled: boolean;
}

function toIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The calendar popover behind {@link SsDatepickerService}. Anchored under (or
 * above, when out of space) its date input; picking a day writes 'YYYY-MM-DD'
 * into the input and fires native `input`/`change` so the page's form control
 * updates. Mousedown inside the panel is swallowed so the anchor input keeps
 * focus; outside interaction, Esc, or tabbing away closes the popover.
 */
@Component({
  selector: 'ss-datepicker-panel',
  standalone: true,
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ss-pop',
    role: 'dialog',
    // Host bindings can't use pipes — `tr()` in a computed is the equivalent.
    '[attr.aria-label]': 'calendarLabel()',
    '[style.top.px]': 'top()',
    '[style.left.px]': 'left()',
    '(mousedown)': '$event.preventDefault()',
  },
  template: `
    <div class="ss-pop-head">
      <button
        class="ss-icon-btn ss-icon-btn--s"
        type="button"
        tabindex="-1"
        [attr.aria-label]="'წინა თვე' | t"
        (click)="prevMonth()"
      >
        <i class="ss-ic" style="--ss-ic: url('assets/taiga-ui/icons/chevron-left.svg')"></i>
      </button>
      <span class="ss-pop-title georgian-text" lang="ka">{{ title() }}</span>
      <button
        class="ss-icon-btn ss-icon-btn--s"
        type="button"
        tabindex="-1"
        [attr.aria-label]="'შემდეგი თვე' | t"
        (click)="nextMonth()"
      >
        <i class="ss-ic" style="--ss-ic: url('assets/taiga-ui/icons/chevron-right.svg')"></i>
      </button>
    </div>

    <div class="ss-pop-grid">
      @for (dow of weekdays; track dow) {
        <span class="ss-pop-dow georgian-text" lang="ka">{{ dow }}</span>
      }
      @for (day of days(); track day.iso) {
        <button
          type="button"
          class="ss-pop-day"
          tabindex="-1"
          [class.is-out]="day.out"
          [class.is-today]="day.today"
          [class.is-selected]="day.selected"
          [disabled]="day.disabled"
          [attr.aria-label]="day.iso"
          (click)="pick(day)"
        >
          {{ day.num }}
        </button>
      }
    </div>

    <div class="ss-pop-foot">
      <button class="ss-btn ss-btn--flat ss-btn--s" type="button" tabindex="-1" (click)="pickToday()">
        <span class="georgian-text" lang="ka">{{ 'დღეს' | t }}</span>
      </button>
      <button class="ss-btn ss-btn--flat ss-btn--s" type="button" tabindex="-1" (click)="clear()">
        <span class="georgian-text" lang="ka">{{ 'გასუფთავება' | t }}</span>
      </button>
    </div>
  `,
})
export class SsDatepickerPanelComponent implements OnDestroy {
  /** The date input this popover is attached to (may retarget while open). */
  readonly anchor = input.required<HTMLInputElement>();

  private readonly svc = inject(SsDatepickerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly weekdays = WEEKDAYS_KA;

  /** Live host aria-label — recomputes when the language flips. */
  protected readonly calendarLabel = computed(() => tr('კალენდარი'));

  /** Off-screen until the first reposition to avoid a corner flash. */
  protected readonly top = signal(-9999);
  protected readonly left = signal(-9999);

  private readonly viewYear = signal(new Date().getFullYear());
  private readonly viewMonth = signal(new Date().getMonth());
  /** Mirrors the anchor's value ('' or 'YYYY-MM-DD'). */
  private readonly value = signal('');

  protected readonly title = computed(() => `${MONTHS_KA[this.viewMonth()]} ${this.viewYear()}`);

  protected readonly days = computed<DayCell[]>(() => {
    const y = this.viewYear();
    const m = this.viewMonth();
    const anchor = this.anchor();
    const min = anchor.min || '';
    const max = anchor.max || '';
    const selected = this.value();
    const todayIso = toIso(new Date());
    const mondayOffset = (new Date(y, m, 1).getDay() + 6) % 7;

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(y, m, 1 - mondayOffset + i);
      const iso = toIso(d);
      return {
        iso,
        num: d.getDate(),
        out: d.getMonth() !== m,
        today: iso === todayIso,
        selected: iso === selected,
        // ISO strings compare correctly lexicographically.
        disabled: (min !== '' && iso < min) || (max !== '' && iso > max),
      };
    });
  });

  private readonly cleanupFns: Array<() => void> = [];

  constructor() {
    // Sync from the anchor (also when the service retargets the open popover
    // to a different date input) and follow values typed into the segments.
    effect((onCleanup) => {
      const anchor = this.anchor();
      this.syncFromAnchor(anchor);
      const onInput = () => this.syncFromAnchor(anchor);
      anchor.addEventListener('input', onInput);
      onCleanup(() => anchor.removeEventListener('input', onInput));
      requestAnimationFrame(() => this.reposition());
    });

    afterNextRender(() => this.reposition());

    const onDocMousedown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || this.host.nativeElement.contains(target) || target === this.anchor()) {
        return;
      }
      this.svc.close();
    };
    const onDocFocusin = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) {
        return;
      }
      // Another date input focuses → the service retargets this panel instead.
      if (target instanceof HTMLInputElement && target.matches(SS_DATEPICKER_TRIGGER)) {
        return;
      }
      if (this.host.nativeElement.contains(target) || target === this.anchor()) {
        return;
      }
      this.svc.close();
    };
    const onDocKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture phase: swallow it so a dialog underneath doesn't also close.
        e.stopPropagation();
        this.svc.close();
      }
    };
    const onReposition = () => this.reposition();

    document.addEventListener('mousedown', onDocMousedown, true);
    document.addEventListener('focusin', onDocFocusin, true);
    document.addEventListener('keydown', onDocKeydown, true);
    document.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    this.cleanupFns.push(
      () => document.removeEventListener('mousedown', onDocMousedown, true),
      () => document.removeEventListener('focusin', onDocFocusin, true),
      () => document.removeEventListener('keydown', onDocKeydown, true),
      () => document.removeEventListener('scroll', onReposition, true),
      () => window.removeEventListener('resize', onReposition),
    );
  }

  ngOnDestroy(): void {
    this.cleanupFns.forEach((fn) => fn());
  }

  protected prevMonth(): void {
    if (this.viewMonth() === 0) {
      this.viewMonth.set(11);
      this.viewYear.update((y) => y - 1);
    } else {
      this.viewMonth.update((m) => m - 1);
    }
  }

  protected nextMonth(): void {
    if (this.viewMonth() === 11) {
      this.viewMonth.set(0);
      this.viewYear.update((y) => y + 1);
    } else {
      this.viewMonth.update((m) => m + 1);
    }
  }

  protected pick(day: DayCell): void {
    if (day.disabled) {
      return;
    }
    this.write(day.iso);
  }

  protected pickToday(): void {
    this.write(toIso(new Date()));
  }

  protected clear(): void {
    this.write('');
  }

  private write(iso: string): void {
    const anchor = this.anchor();
    anchor.value = iso;
    anchor.dispatchEvent(new Event('input', { bubbles: true }));
    anchor.dispatchEvent(new Event('change', { bubbles: true }));
    this.svc.close();
  }

  private syncFromAnchor(anchor: HTMLInputElement): void {
    const v = anchor.value;
    this.value.set(v);
    const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (parsed) {
      this.viewYear.set(Number(parsed[1]));
      this.viewMonth.set(Number(parsed[2]) - 1);
    } else {
      const now = new Date();
      this.viewYear.set(now.getFullYear());
      this.viewMonth.set(now.getMonth());
    }
  }

  private reposition(): void {
    const anchorEl = this.anchor();
    if (!anchorEl.isConnected) {
      this.svc.close();
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const el = this.host.nativeElement;
    const panelH = el.offsetHeight || 330;
    const panelW = el.offsetWidth || 296;
    const gap = 6;
    const margin = 8;

    let top = rect.bottom + gap;
    if (top + panelH > window.innerHeight - margin && rect.top - gap - panelH > margin) {
      top = rect.top - gap - panelH;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - panelH - margin));

    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - panelW - margin));

    this.top.set(Math.round(top));
    this.left.set(Math.round(left));
  }
}
