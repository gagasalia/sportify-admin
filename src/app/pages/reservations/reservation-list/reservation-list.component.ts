import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge, take } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { BookingService } from '../../../services/http-services/booking.service';
import { AuthService } from '../../../shared/services/auth.service';
import { SsToastService } from '../../../shared/ui/toast.service';
import { SsConfirmComponent, SsConfirmData } from '../../../shared/ui/confirm.component';
import { SsDialogService } from '../../../shared/ui/dialog.service';
import { SsAvatarComponent } from '../../../shared/ui/ss-avatar.component';
import { gelToTetri, tetriToGel } from '../../../shared/utils/money.util';
import { formatMemberId, parseMemberId } from '../../../shared/utils/member-id.util';
import {
  Booking,
  BookingQuery,
  BookingSort,
  BookingStatus,
  BookingUserRef,
} from '../../../shared/models/booking.model';
import { GridCourt } from '../calendar-grid';
import { bookingDisplayName, bookingPlayer } from '../booking-display.util';
import { TPipe } from '../../../shared/i18n/t.pipe';
import { liveLabels, tr } from '../../../shared/i18n/lang';

/** ID column filter: only digits can match a public member ID. */
const MEMBER_ID_RX = /^\d+$/;

/**
 * Reservations LIST module: the paginated table behind the calendar's "სია"
 * tab, extracted from the calendar component so the table (per-column filters,
 * server-side sorting, paging, row actions) evolves independently of the grid
 * views. The parent passes the selected facility + its active courts; all list
 * state and fetching live here. Filters auto-apply (text/number inputs
 * debounced); sorting is server-side — reservation date (createdAt, newest
 * first, the default) or playing date (future slots on top).
 */
@Component({
  selector: 'app-reservation-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SsAvatarComponent, TPipe],
  templateUrl: './reservation-list.component.html',
  styleUrl: './reservation-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReservationListComponent {
  readonly facilityId = input.required<string>();
  readonly courts = input<GridCourt[]>([]);

  private readonly bookingService = inject(BookingService);
  private readonly auth = inject(AuthService);
  /** Tip data is superadmin-only (the API omits it for plain admins anyway). */
  protected readonly isSuperAdmin = this.auth.isSuperAdmin;
  private readonly alerts = inject(SsToastService);
  private readonly dialogs = inject(SsDialogService);
  private readonly router = inject(Router);

  readonly bookings = signal<Booking[]>([]);
  readonly total = signal(0);
  /** One-based page index (matches the backend `result.page` convention). */
  readonly page = signal(1);
  readonly limit = 20;
  readonly isLoading = signal(false);
  readonly hasError = signal(false);
  /** Default per request: newest reservation first. */
  readonly sortBy = signal<BookingSort>('created');

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));

  // ── per-column filters ───────────────────────────────────────────────────────
  /** "YYYY-MM-DD" strings; '' = unset (native date inputs clear to ''). */
  readonly createdFrom = new FormControl<string>('', { nonNullable: true });
  readonly createdTo = new FormControl<string>('', { nonNullable: true });
  readonly playFrom = new FormControl<string>('', { nonNullable: true });
  readonly playTo = new FormControl<string>('', { nonNullable: true });
  readonly startHour = new FormControl<number | null>(null);
  readonly court = new FormControl<string | null>(null);
  readonly customer = new FormControl<string>('', { nonNullable: true });
  /** Public member ID digits ("42" or padded "000042"); '' = unset. */
  readonly memberId = new FormControl<string>('', { nonNullable: true });
  /** Price bounds in GEL (converted to tetri at the wire). */
  readonly priceMin = new FormControl<number | null>(null);
  readonly priceMax = new FormControl<number | null>(null);
  readonly status = new FormControl<BookingStatus | null>(null);

  /** Set while the ID input holds a non-empty, non-numeric value. */
  readonly memberIdInvalid = signal(false);

  readonly hourOptions = Array.from({ length: 24 }, (_, h) => ({
    value: h,
    label: `${String(h).padStart(2, '0')}:00`,
  }));

  readonly statusOptions: BookingStatus[] = ['confirmed', 'cancelled', 'completed'];

  /** RAW-Georgian values behind a live proxy — every read translates, never baked. */
  readonly statusLabels: Record<BookingStatus, string> = liveLabels({
    confirmed: 'დადასტურებული',
    cancelled: 'გაუქმებული',
    completed: 'დასრულებული',
  });

  constructor() {
    // Auto-apply: free-text/number inputs settle first; pickers fire directly.
    const debounced = merge(
      this.customer.valueChanges,
      this.memberId.valueChanges,
      this.priceMin.valueChanges,
      this.priceMax.valueChanges,
    ).pipe(debounceTime(400));
    const immediate = merge(
      this.createdFrom.valueChanges,
      this.createdTo.valueChanges,
      this.playFrom.valueChanges,
      this.playTo.valueChanges,
      this.startHour.valueChanges,
      this.court.valueChanges,
      this.status.valueChanges,
    );
    merge(debounced, immediate)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.load(1));

    // Initial load + reload on facility switch. The court filter is
    // per-facility — a stale id would silently filter everything out.
    effect(() => {
      this.facilityId();
      untracked(() => {
        if (this.court.value !== null) this.court.setValue(null, { emitEvent: false });
        this.load(1);
      });
    });
  }

  /** `page` is one-based (page 1 = first page), matching the backend contract. */
  load(page = 1): void {
    const memberIdRaw = this.memberId.value.trim();
    const invalid = memberIdRaw.length > 0 && !MEMBER_ID_RX.test(memberIdRaw);
    this.memberIdInvalid.set(invalid);
    // Wait for a numeric ID instead of querying something that can't match.
    if (invalid) return;

    this.page.set(page);
    this.isLoading.set(true);
    this.hasError.set(false);

    const query: BookingQuery = {
      createdFrom: this.createdFrom.value || undefined,
      createdTo: this.createdTo.value || undefined,
      from: this.playFrom.value || undefined,
      to: this.playTo.value || undefined,
      startHour: this.startHour.value ?? undefined,
      courtId: this.court.value ?? undefined,
      customer: this.customer.value.trim() || undefined,
      memberId: parseMemberId(memberIdRaw) ?? undefined,
      priceMinTetri: this.priceMin.value != null ? gelToTetri(this.priceMin.value) : undefined,
      priceMaxTetri: this.priceMax.value != null ? gelToTetri(this.priceMax.value) : undefined,
      status: this.status.value ?? undefined,
      sortBy: this.sortBy(),
      page,
      limit: this.limit,
    };

    this.bookingService
      .getBookings(this.facilityId(), query)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          this.bookings.set(res.data);
          this.total.set(res.page?.total ?? res.data.length);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.hasError.set(true);
        },
      });
  }

  setSort(sort: BookingSort): void {
    if (sort === this.sortBy()) return;
    this.sortBy.set(sort);
    this.load(1);
  }

  nextPage(): void {
    if (this.page() * this.limit < this.total()) this.load(this.page() + 1);
  }

  prevPage(): void {
    if (this.page() > 1) this.load(this.page() - 1);
  }

  hasActiveFilters(): boolean {
    return !!(
      this.createdFrom.value ||
      this.createdTo.value ||
      this.playFrom.value ||
      this.playTo.value ||
      this.startHour.value !== null ||
      this.court.value !== null ||
      this.customer.value.trim() ||
      this.memberId.value.trim() ||
      this.priceMin.value != null ||
      this.priceMax.value != null ||
      this.status.value !== null
    );
  }

  clearFilters(): void {
    // Silent resets — one explicit reload instead of a per-control storm.
    for (const c of [this.createdFrom, this.createdTo, this.playFrom, this.playTo]) {
      c.setValue('', { emitEvent: false });
    }
    this.customer.setValue('', { emitEvent: false });
    this.memberId.setValue('', { emitEvent: false });
    this.startHour.setValue(null, { emitEvent: false });
    this.court.setValue(null, { emitEvent: false });
    this.priceMin.setValue(null, { emitEvent: false });
    this.priceMax.setValue(null, { emitEvent: false });
    this.status.setValue(null, { emitEvent: false });
    this.load(1);
  }

  // ── row helpers ──────────────────────────────────────────────────────────────
  courtLabelById(courtId: string): string {
    return this.courts().find((c) => c.id === courtId)?.label ?? '';
  }

  bookingPlayer(b: Booking): BookingUserRef | null {
    return bookingPlayer(b);
  }

  displayName(b: Booking): string | null {
    return bookingDisplayName(b);
  }

  /** The player's public member ID for the ID column ("000042"); manual/legacy rows have none. */
  playerId(b: Booking): string | null {
    return formatMemberId(bookingPlayer(b)?.memberId) || null;
  }

  /** Open the player's customer page (list row link). */
  openPlayer(b: Booking, event?: Event): void {
    event?.stopPropagation();
    const u = bookingPlayer(b);
    if (u) void this.router.navigate(['/customers', u._id]);
  }

  bookingPriceGel(booking: Booking): number | null {
    return booking.priceTetri != null ? tetriToGel(booking.priceTetri) : null;
  }

  /** App-support tip in GEL; null when none (or when the API redacted it). */
  bookingTipGel(booking: Booking): number | null {
    return booking.tipTetri ? tetriToGel(booking.tipTetri) : null;
  }

  /**
   * Status badge: cancelled → negative, completed → neutral (a played-out
   * booking is past, not an active green one), confirmed → positive.
   */
  statusBadgeClass(status: BookingStatus): string {
    if (status === 'cancelled') return 'ss-badge ss-badge--negative';
    if (status === 'completed') return 'ss-badge ss-badge--neutral';
    return 'ss-badge ss-badge--positive';
  }

  cancelFromList(booking: Booking): void {
    const data: SsConfirmData = {
      content: tr('ჯავშნის გაუქმება გსურთ?'),
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
          this.load(this.page());
        },
        error: () => {
          this.alerts
            .open(tr('შეცდომა გაუქმებისას.'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }
}
