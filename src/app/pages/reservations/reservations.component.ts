import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { forkJoin, of, take } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BookingService } from '../../services/http-services/booking.service';
import { CourtService } from '../../services/http-services/court.service';
import { FacilityService } from '../../services/http-services/facility.service';
import { ScheduleService } from '../../services/http-services/schedule.service';
import { TenantService } from '../../shared/services/tenant.service';
import { tetriToGel } from '../../shared/utils/money.util';
import { Court } from '../../shared/models/court.model';
import { Facility } from '../../shared/models/facility.model';
import { FacilityScheduleDTO } from '../../shared/models/schedule.model';
import { Booking, BookingUserRef } from '../../shared/models/booking.model';
import {
  DayGrid,
  GridCell,
  GridCourt,
  Selection,
  WeekDayData,
  WeekGrid,
  buildDayGrid,
  buildWeekGrid,
  hhmmToMinutes,
  isBookableDuration,
  minutesToHHmm,
  priceForWindow,
  selectionMinutes,
  toggleCell,
} from './calendar-grid';
import { shiftIso, todayIso, weekDates } from './calendar-date.util';
import {
  BookingDialogComponent,
  BookingDialogData,
} from './booking-dialog/booking-dialog.component';

import { SsToastService } from '../../shared/ui/toast.service';
import { SsConfirmComponent, SsConfirmData } from '../../shared/ui/confirm.component';
import { SsDialogService } from '../../shared/ui/dialog.service';
import { ReservationListComponent } from './reservation-list/reservation-list.component';
import { bookingDisplayName, bookingPlayer } from './booking-display.util';
import { TPipe } from '../../shared/i18n/t.pipe';
import { isEnglish, liveList, tr } from '../../shared/i18n/lang';
type CalendarTab = 'day' | 'week' | 'list';

/** One chip on the horizontal date rail. */
interface DateOption {
  iso: string; // "YYYY-MM-DD"
  dayNum: string; // "31"
  label: string; // დღეს / ხვალ / weekday short
}

/** Days shown on the date rail (today + 13). Further dates use the datepicker. */
const DATE_RAIL_DAYS = 14;

/**
 * Georgian 3-letter weekday names, Monday=0. RAW on purpose — the rail labels
 * are STORED in `dateOptions`, so translating here would bake the language in.
 * Both readers translate at render time with the `t` pipe.
 */
const WEEKDAY_SHORT = ['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვი'];

/** Georgian 3-letter month names — read only at render, so live-translated. */
const MONTH_SHORT = liveList([
  'იან',
  'თებ',
  'მარ',
  'აპრ',
  'მაი',
  'ივნ',
  'ივლ',
  'აგვ',
  'სექ',
  'ოქტ',
  'ნოე',
  'დეკ',
]);

/**
 * Operator calendar. Day view is the primary surface: a CSS-table of active
 * courts × the facility's 30-minute cell grid, built from the SCHEDULE
 * (hours/holidays/pricing) + the day's bookings — see `calendar-grid.ts`.
 * Facility, date and (week/mobile) court pickers are single-select chip rails;
 * adjacent free cells are multi-selectable and a floating bar opens the create
 * dialog for the whole range. Week view is one court × 7 days; the list view is
 * its own module (`ReservationListComponent`) — a filtered, sortable table
 * that owns all of its state. All grid math lives in `calendar-grid`.
 */
@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ReservationListComponent, TPipe],
  templateUrl: './reservations.component.html',
  styleUrl: './reservations.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReservationsComponent implements OnInit {
  private readonly bookingService = inject(BookingService);
  private readonly courtService = inject(CourtService);
  private readonly facilityService = inject(FacilityService);
  private readonly scheduleService = inject(ScheduleService);
  private readonly tenant = inject(TenantService);
  private readonly alerts = inject(SsToastService);
  private readonly dialogs = inject(SsDialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // ── selection / facility state ───────────────────────────────────────────────
  readonly facilities = signal<Facility[]>([]);
  readonly courts = signal<Court[]>([]);
  readonly selectedFacilityId = signal<string | null>(null);
  readonly schedule = signal<FacilityScheduleDTO | null>(null);

  readonly tab = signal<CalendarTab>('day');
  readonly isMobile = signal(false);

  // ── date state ───────────────────────────────────────────────────────────────
  readonly selectedDate = signal<string>(todayIso());
  /**
   * Native datepicker for dates beyond the rail; kept in sync with the rail.
   * Holds a "YYYY-MM-DD" string — the native `<input type="date">` value format.
   */
  readonly dateControl = new FormControl<string>(todayIso(), { nonNullable: true });
  readonly dateOptions: DateOption[] = this.buildDateOptions();

  readonly dayBookings = signal<Booking[]>([]);

  // ── week view state ──────────────────────────────────────────────────────────
  readonly selectedCourtId = signal<string | null>(null);
  readonly weekData = signal<WeekDayData[]>([]);

  // ── multi-cell selection (day + week grids) ──────────────────────────────────
  readonly selection = signal<Selection>([]);

  // ── ui state ─────────────────────────────────────────────────────────────────
  readonly isLoading = signal(false);
  readonly hasError = signal(false);

  // ── derived ──────────────────────────────────────────────────────────────────
  /** Active courts only, ordered by court name — the day-grid column axis. */
  readonly activeCourts = computed<GridCourt[]>(() =>
    this.courts()
      .filter((c) => c.activeState)
      .map((c) => ({
        id: c._id ?? c.id ?? '',
        name: c.name,
        label: c.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** On mobile the day view shows a single court; default to the first active one. */
  readonly visibleDayCourts = computed<GridCourt[]>(() => {
    const all = this.activeCourts();
    if (!this.isMobile()) return all;
    const selected = this.selectedCourtId();
    const one = all.find((c) => c.id === selected) ?? all[0];
    return one ? [one] : [];
  });

  readonly dayGrid = computed<DayGrid>(() =>
    buildDayGrid(
      this.visibleDayCourts(),
      this.selectedDate(),
      this.schedule(),
      this.dayBookings(),
      this.nowMinutesFor(this.selectedDate()),
    ),
  );

  readonly weekGrid = computed<WeekGrid>(() => {
    const courtId = this.selectedCourtId();
    if (!courtId) return { days: [], rows: [] };
    return buildWeekGrid(
      courtId,
      this.weekData(),
      this.schedule(),
      todayIso(),
      this.nowMinutesFor(todayIso()),
    );
  });

  /** Floating-bar summary of the current selection (null when empty). */
  readonly selectionInfo = computed(() => {
    const sel = this.selection();
    if (sel.length === 0) return null;
    const minutes = selectionMinutes(sel);
    const startMin = hhmmToMinutes(sel[0].start);
    const endMin = startMin + minutes;
    const priceTetri = priceForWindow(startMin, endMin, this.schedule()?.pricing);
    return {
      courtLabel: this.courtLabelById(sel[0].courtId),
      date: sel[0].date,
      start: sel[0].start,
      end: minutesToHHmm(endMin),
      minutes,
      priceGel: tetriToGel(priceTetri),
      priceTetri,
      canContinue: minutes >= 60,
      bookable: isBookableDuration(minutes),
    };
  });

  private facilityIdOf(f: Facility): string | null {
    return f._id ?? f.id ?? null;
  }

  facilityLabel(f: Facility): string {
    return f.name || f.description || tr('უსახელო ობიექტი');
  }

  constructor() {
    this.checkMobile();
    this.dateControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((iso) => {
      if (iso && iso !== this.selectedDate()) this.goToDate(iso);
    });
  }

  ngOnInit(): void {
    // Resolve the tenant first so a hard refresh / deep link onto /reservations
    // waits for `/academy/my` before reading `academyId()`.
    this.tenant
      .ensure()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadFacilities());
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.checkMobile();
  }

  private checkMobile(): void {
    this.isMobile.set(typeof window !== 'undefined' && window.innerWidth <= 768);
  }

  /**
   * Sense override: the dictionary maps 'კვირა' to Sunday (weekday labels),
   * but this tab means the week view. isEnglish() reads the language signal,
   * so the label stays live across a toggle.
   */
  protected weekWord(): string {
    return isEnglish() ? 'Week' : 'კვირა';
  }

  setTab(tab: CalendarTab): void {
    if (tab === this.tab()) return;
    this.tab.set(tab);
    this.clearSelection();
    // The list tab is self-contained: ReservationListComponent fetches on init.
    if (tab === 'day') this.loadDay();
    if (tab === 'week') this.loadWeek();
  }

  // ── date rail ────────────────────────────────────────────────────────────────
  private buildDateOptions(): DateOption[] {
    const start = todayIso();
    return Array.from({ length: DATE_RAIL_DAYS }, (_, i) => {
      const iso = shiftIso(start, i);
      const [y, m, d] = iso.split('-').map(Number);
      const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
      return {
        iso,
        dayNum: String(d).padStart(2, '0'),
        label: i === 0 ? 'დღეს' : i === 1 ? 'ხვალ' : WEEKDAY_SHORT[weekday],
      };
    });
  }

  /** True when the selected date is not on the rail (picked via the datepicker). */
  readonly isOffRailDate = computed(
    () => !this.dateOptions.some((o) => o.iso === this.selectedDate()),
  );

  selectDate(iso: string): void {
    if (iso === this.selectedDate()) return;
    this.goToDate(iso);
  }

  private goToDate(iso: string): void {
    this.selectedDate.set(iso);
    this.dateControl.setValue(iso, { emitEvent: false });
    this.clearSelection();
    if (this.tab() === 'week') this.loadWeek();
    else this.loadDay();
  }

  /** Facility-local "now" in minutes for past-cell marking; undefined off-today. */
  private nowMinutesFor(date: string): number | undefined {
    if (date !== todayIso()) return undefined;
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  // ── facility resolution ─────────────────────────────────────────────────────
  private loadFacilities(): void {
    const academyId = this.tenant.academyId();
    if (!academyId) {
      this.facilities.set([]);
      this.selectedFacilityId.set(null);
      return;
    }
    this.facilityService
      .getFacilitiesByAcademy(academyId)
      .pipe(take(1))
      .subscribe({
        next: (facilities) => {
          this.facilities.set(facilities);
          this.resolveSelection(facilities);
        },
        error: () => this.hasError.set(true),
      });
  }

  /** The first chip is selected by default; a valid ?facilityId= overrides it. */
  private resolveSelection(facilities: Facility[]): void {
    this.route.queryParams.pipe(take(1)).subscribe((params) => {
      if (facilities.length === 0) {
        this.selectFacility(null);
        return;
      }
      const fromQuery = params['facilityId'];
      const match = facilities.find((f) => this.facilityIdOf(f) === fromQuery);
      const fId = match ? this.facilityIdOf(match) : this.facilityIdOf(facilities[0]);
      if (fromQuery !== fId) this.updateQueryParam(fId);
      this.selectFacility(fId);
    });
  }

  onFacilityChipClick(facility: Facility): void {
    const fId = this.facilityIdOf(facility);
    if (fId === this.selectedFacilityId()) return;
    this.updateQueryParam(fId);
    this.selectFacility(fId);
  }

  private selectFacility(facilityId: string | null): void {
    this.selectedFacilityId.set(facilityId);
    this.courts.set([]);
    this.schedule.set(null);
    this.selectedCourtId.set(null);
    this.clearSelection();
    if (facilityId) {
      this.loadCourtsThenData(facilityId);
    }
  }

  private updateQueryParam(facilityId: string | null): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { facilityId: facilityId || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private loadCourtsThenData(facilityId: string): void {
    this.isLoading.set(true);
    this.hasError.set(false);
    forkJoin({
      courts: this.courtService.getCourts(facilityId),
      schedule: this.scheduleService
        .getSchedule(facilityId)
        .pipe(catchError(() => of<FacilityScheduleDTO | null>(null))),
    })
      .pipe(take(1))
      .subscribe({
        next: ({ courts, schedule }) => {
          this.courts.set(courts);
          this.schedule.set(schedule);
          this.selectedCourtId.set(this.activeCourts()[0]?.id ?? null);
          if (this.tab() === 'week') this.loadWeek();
          else if (this.tab() === 'list') this.isLoading.set(false); // child fetches itself
          else this.loadDay();
        },
        error: () => {
          this.isLoading.set(false);
          this.hasError.set(true);
        },
      });
  }

  // ── day view ─────────────────────────────────────────────────────────────────
  private loadDay(): void {
    const facilityId = this.selectedFacilityId();
    if (!facilityId) return;
    const date = this.selectedDate();
    this.isLoading.set(true);
    this.hasError.set(false);

    this.bookingService
      .getBookings(facilityId, { date })
      .pipe(take(1))
      .subscribe({
        next: (bookings) => {
          this.dayBookings.set(bookings.data);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.hasError.set(true);
        },
      });
  }

  prevDay(): void {
    // In week view the step is a whole week so the user pages between weeks.
    this.goToDate(shiftIso(this.selectedDate(), this.tab() === 'week' ? -7 : -1));
  }

  nextDay(): void {
    this.goToDate(shiftIso(this.selectedDate(), this.tab() === 'week' ? 7 : 1));
  }

  // ── week view ────────────────────────────────────────────────────────────────
  /** The Monday-anchored 7-day window containing the selected date. */
  readonly weekRange = computed(() => {
    const dates = weekDates(this.selectedDate());
    return { from: dates[0], to: dates[6] };
  });

  private loadWeek(): void {
    const facilityId = this.selectedFacilityId();
    const courtId = this.selectedCourtId();
    if (!facilityId || !courtId) return;
    const dates = weekDates(this.selectedDate());
    this.isLoading.set(true);
    this.hasError.set(false);

    // ONE ranged request for the whole week (was 7 per-day calls — a burst that
    // tripped the API's rate limit and re-fired 7 requests on every retry).
    // limit=200 is the API max; a single court's week never comes close.
    this.bookingService
      .getBookings(facilityId, {
        from: dates[0],
        to: dates[6],
        courtId,
        limit: 200,
      })
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          const byDate = new Map<string, Booking[]>(dates.map((d) => [d, []]));
          for (const b of res.data) {
            byDate.get(b.date)?.push(b);
          }
          this.weekData.set(dates.map((date) => ({ date, bookings: byDate.get(date) ?? [] })));
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.hasError.set(true);
        },
      });
  }

  onCourtChipClick(courtId: string): void {
    // Guard against redundant 7-call week reloads when a rapid toggle re-selects
    // the already-active court.
    if (courtId === this.selectedCourtId()) return;
    this.selectedCourtId.set(courtId);
    this.clearSelection();
    if (this.tab() === 'week') this.loadWeek();
  }

  courtLabelById(courtId: string): string {
    return this.activeCourts().find((c) => c.id === courtId)?.label ?? '';
  }

  // ── cell interactions ────────────────────────────────────────────────────────
  /**
   * Grid cell click: free cells toggle in/out of the multi-slot selection
   * (adjacent cells on one court+date — see `toggleCell`); booking/block cells
   * open the cancel flow. `past`/`closed` cells are inert.
   */
  onCellClick(cell: GridCell): void {
    if (cell.kind === 'free') {
      this.selection.update((sel) =>
        toggleCell(sel, { courtId: cell.courtId, date: cell.date, start: cell.start }),
      );
    } else if (cell.booking) {
      this.openBookingActions(cell.booking);
    }
  }

  isSelected(cell: GridCell): boolean {
    return this.selection().some(
      (c) => c.courtId === cell.courtId && c.date === cell.date && c.start === cell.start,
    );
  }

  clearSelection(): void {
    if (this.selection().length > 0) this.selection.set([]);
  }

  /** Open the create dialog for the selected contiguous range. */
  openSelectionDialog(): void {
    const info = this.selectionInfo();
    const sel = this.selection();
    const facilityId = this.selectedFacilityId();
    if (!info || !info.canContinue || sel.length === 0 || !facilityId) return;

    const data: BookingDialogData = {
      facilityId,
      court: sel[0].courtId,
      courtLabel: info.courtLabel,
      date: info.date,
      start: info.start,
      end: info.end,
      durationMinutes: info.minutes,
      priceTetri: info.priceTetri,
      allowBooking: info.bookable,
    };

    this.dialogs
      .open<boolean>(BookingDialogComponent, {
        label: `${info.courtLabel} · ${info.start}–${info.end}`,
        size: 'm',
        dismissible: true,
        closable: true,
        data,
      })
      .pipe(take(1))
      .subscribe((saved) => {
        if (saved) {
          this.clearSelection();
          this.refreshActive();
        }
      });
  }

  private openBookingActions(booking: Booking): void {
    if (booking.type === 'block') {
      this.confirmCancel(booking, tr('ბლოკის მოხსნა გსურთ?'));
      return;
    }
    // For bookings, offer cancel; mark-paid is a separate cell action button.
    this.confirmCancel(booking, tr('ჯავშნის გაუქმება გსურთ?'));
  }

  confirmCancel(booking: Booking, content: string): void {
    const data: SsConfirmData = {
      content,
      yes: tr('დიახ'),
      no: tr('არა'),
      appearance: 'destructive',
    };
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('დადასტურება'),
        size: 's',
        data,
      })
      .pipe(take(1))
      .subscribe((confirmed) => {
        if (confirmed) this.cancelBooking(booking);
      });
  }

  private cancelBooking(booking: Booking): void {
    this.bookingService
      .cancelBooking(booking._id)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.alerts.open(tr('გაუქმებულია'), { appearance: 'success' }).pipe(take(1)).subscribe();
          this.refreshActive();
        },
        error: () => {
          this.alerts
            .open(tr('შეცდომა გაუქმებისას.'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  markPaid(booking: Booking, event?: Event): void {
    event?.stopPropagation();
    const data: SsConfirmData = {
      content: tr('ჯავშანი მოინიშნოს გადახდილად?'),
      yes: tr('დიახ'),
      no: tr('არა'),
    };
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('გადახდის დადასტურება'),
        size: 's',
        data,
      })
      .pipe(take(1))
      .subscribe((confirmed) => {
        if (confirmed) this.doMarkPaid(booking);
      });
  }

  private doMarkPaid(booking: Booking): void {
    this.bookingService
      .markPaid(booking._id)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.alerts.open(tr('გადახდილია'), { appearance: 'success' }).pipe(take(1)).subscribe();
          this.refreshActive();
        },
        error: () => {
          this.alerts
            .open(tr('შეცდომა გადახდის აღნიშვნისას.'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  private refreshActive(): void {
    // Only the calendar tabs mutate from here; the list module refreshes itself.
    const tab = this.tab();
    if (tab === 'day') this.loadDay();
    else if (tab === 'week') this.loadWeek();
  }

  // ── cell display helpers (kept thin; heavy logic is in calendar-grid) ────────
  /**
   * Inline cell title. Notes are NOT inlined — they surface via the info-icon
   * tooltip (`cellNote`) so every cell stays one clean line.
   */
  cellLabel(cell: GridCell): string {
    const b = cell.booking;
    if (!b) return '';
    if (b.type === 'block') return tr('დაბლოკილია');
    // The customer/player name is DATA — only the fallback label translates.
    return this.displayName(b) ?? tr('ჯავშანი');
  }

  // ── player identity (populated on operator reads) ────────────────────────────
  /** The populated player ref, or null for manual/legacy rows. */
  bookingPlayer(b: Booking): BookingUserRef | null {
    return bookingPlayer(b);
  }

  /** Who the slot belongs to: manual customerName or the player's name. */
  displayName(b: Booking): string | null {
    return bookingDisplayName(b);
  }

  /** Open the player's customer page (cell profile button). */
  openPlayer(b: Booking, event?: Event): void {
    event?.stopPropagation();
    const u = this.bookingPlayer(b);
    if (u) void this.router.navigate(['/customers', u._id]);
  }

  /** Operator note / block reason shown in the cell's info tooltip. */
  cellNote(cell: GridCell): string | null {
    return cell.booking?.note || null;
  }

  /** Color-group class of a cell (free/user/admin/block/past/closed/selected). */
  cellClass(cell: GridCell): string {
    switch (cell.kind) {
      case 'free':
        return this.isSelected(cell) ? 'cal-cell cell-free is-selected' : 'cal-cell cell-free';
      case 'booking':
        return cell.byUser ? 'cal-cell cell-user' : 'cal-cell cell-admin';
      case 'block':
        return 'cal-cell cell-block';
      case 'past':
        return 'cal-cell cell-past';
      default:
        return 'cal-cell cell-closed';
    }
  }

  cellPriceGel(cell: GridCell): number | null {
    return cell.priceTetri != null ? tetriToGel(cell.priceTetri) : null;
  }

  /** Duration of a booking/block span in minutes (for the cell subtitle). */
  cellSpanMinutes(cell: GridCell): number {
    return hhmmToMinutes(cell.end) - hhmmToMinutes(cell.start);
  }

  isPaid(cell: GridCell): boolean {
    return cell.booking?.paymentStatus === 'paid';
  }

  /** "31 ივლ" / "31 Jul" — compact week-column header (built per render). */
  weekDayLabel(iso: string): string {
    const [, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTH_SHORT[m - 1]}`;
  }

  weekdayShortOf(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return WEEKDAY_SHORT[weekday];
  }

  isToday(iso: string): boolean {
    return iso === todayIso();
  }

  navigateToFacilities(): void {
    this.router.navigate(['/configuration/facilities']);
  }
}
