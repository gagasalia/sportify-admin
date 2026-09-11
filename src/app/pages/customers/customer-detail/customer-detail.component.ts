import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { filter, switchMap, take } from 'rxjs';
import { liveLabels, tr } from '../../../shared/i18n/lang';
import { FacilityNamesService } from '../../../shared/i18n/facility-names.service';
import { localizedCourtName } from '../../../shared/i18n/localized';
import { TPipe } from '../../../shared/i18n/t.pipe';
import { CustomersService } from '../../../services/http-services/customers.service';
import { AuthService } from '../../../shared/services/auth.service';
import { SsDialogService } from '../../../shared/ui/dialog.service';
import { SsToastService } from '../../../shared/ui/toast.service';
import { SsConfirmComponent, SsConfirmData } from '../../../shared/ui/confirm.component';
import {
  CustomerBookingRow,
  CustomerDetail,
  ModerationActionType,
} from '../../../shared/models/customer.model';
import { KpiCardComponent } from '../../statistics/charts/kpi-card.component';
import { SsAvatarComponent } from '../../../shared/ui/ss-avatar.component';
import { formatMemberId } from '../../../shared/utils/member-id.util';
import { ReasonDialogComponent, ReasonDialogData } from '../reason-dialog.component';
import { ContactDialogComponent, ContactDialogData } from '../contact-dialog.component';

const BOOKINGS_PAGE_SIZE = 10;

/**
 * One customer's page: profile + moderation state, activity KPIs, the
 * moderation audit trail and the (scope-filtered) booking history — with the
 * operator actions: ban/unban, flag/unflag, contact fixes.
 */
@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [DatePipe, RouterLink, KpiCardComponent, SsAvatarComponent, TPipe],
  templateUrl: './customer-detail.component.html',
  styleUrl: './customer-detail.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerDetailComponent implements OnInit {
  private readonly customersService = inject(CustomersService);
  private readonly facilityNames = inject(FacilityNamesService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSuperAdmin = this.auth.isSuperAdmin;

  protected readonly id = signal<string>('');
  protected readonly detail = signal<CustomerDetail | null>(null);

  /** Booking-row court name: the English snapshot in an English session. */
  protected readonly localizedCourtName = localizedCourtName;

  /** Booking-row venue: the live facility name, falling back to the snapshot. */
  protected facilityLabel(row: { facility?: string; facilityName?: string }): string {
    return this.facilityNames.label(row.facility, row.facilityName);
  }

  protected readonly isLoading = signal(true);
  protected readonly hasError = signal(false);

  protected readonly bookingRows = signal<CustomerBookingRow[]>([]);
  protected readonly bookingsPage = signal(1);
  protected readonly bookingsTotal = signal(0);
  protected readonly bookingsLoading = signal(true);
  protected readonly bookingsLimit = BOOKINGS_PAGE_SIZE;
  protected readonly bookingsPages = computed(() =>
    Math.max(1, Math.ceil(this.bookingsTotal() / this.bookingsLimit)),
  );

  // RAW Georgian values behind a liveLabels proxy: every read goes through
  // tr(), so the template picks up a language flip without a reload.
  protected readonly statusLabels: Record<string, string> = liveLabels({
    confirmed: 'დადასტურებული',
    cancelled: 'გაუქმებული',
    completed: 'დასრულებული',
  });
  protected readonly actionLabels: Record<ModerationActionType, string> = liveLabels({
    ban: 'დაბლოკვა',
    unban: 'განბლოკვა',
    flag: 'მონიშვნა',
    unflag: 'მონიშვნის მოხსნა',
    contact_fix: 'მონაცემების შესწორება',
  });

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('id');
        if (!id) return;
        this.id.set(id);
        this.load();
      });
  }

  protected load(): void {
    const id = this.id();
    this.isLoading.set(true);
    this.hasError.set(false);
    this.customersService
      .detail(id)
      .pipe(take(1))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.hasError.set(true);
        },
      });
    this.loadBookings(1);
  }

  protected loadBookings(page: number): void {
    this.bookingsPage.set(page);
    this.bookingsLoading.set(true);
    this.customersService
      .bookings(this.id(), page, this.bookingsLimit)
      .pipe(take(1))
      .subscribe({
        next: ({ data, page: p }) => {
          this.bookingRows.set(data);
          this.bookingsTotal.set(p?.total ?? data.length);
          this.bookingsLoading.set(false);
        },
        error: () => this.bookingsLoading.set(false),
      });
  }

  // ── moderation actions ─────────────────────────────────────────────────────

  protected ban(): void {
    this.dialogs
      .open<string | null>(ReasonDialogComponent, {
        // The dialog header is rendered raw by the outlet → translate here;
        // the payload below stays RAW (ReasonDialogComponent applies `| t`).
        label: tr('ანგარიშის დაბლოკვა'),
        size: 'm',
        dismissible: true,
        closable: true,
        data: {
          content:
            'დაბლოკილი მომხმარებელი ვეღარ შევა სისტემაში და ვეღარ დაჯავშნის ვერცერთ კორტს.',
          placeholder: 'მაგ: ქრონიკული გამოუცხადებლობა',
          yes: 'დაბლოკვა',
          destructive: true,
        } as ReasonDialogData,
      })
      .pipe(
        take(1),
        filter((reason): reason is string => !!reason),
        switchMap((reason) => this.customersService.ban(this.id(), reason)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (moderation) => {
          this.patchModeration(moderation);
          this.toast(tr('მომხმარებელი დაიბლოკა'), 'success');
        },
        error: () => this.toast(tr('დაბლოკვა ვერ მოხერხდა'), 'error'),
      });
  }

  protected unban(): void {
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        // SsConfirmComponent renders its payload raw → translate at the call site.
        label: tr('განბლოკვა'),
        size: 's',
        data: {
          content: tr('მოვხსნათ ბლოკი ამ ანგარიშიდან?'),
          yes: tr('განბლოკვა'),
          no: tr('გაუქმება'),
        } as SsConfirmData,
      })
      .pipe(
        take(1),
        filter(Boolean),
        switchMap(() => this.customersService.unban(this.id())),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (moderation) => {
          this.patchModeration(moderation);
          this.toast(tr('ბლოკი მოხსნილია'), 'success');
        },
        error: () => this.toast(tr('განბლოკვა ვერ მოხერხდა'), 'error'),
      });
  }

  protected flagCustomer(): void {
    this.dialogs
      .open<string | null>(ReasonDialogComponent, {
        label: tr('მომხმარებლის მონიშვნა'),
        size: 'm',
        dismissible: true,
        closable: true,
        data: {
          content:
            'მონიშვნა შიდა ნიშანია ოპერატორებისთვის (მაგ. ხშირი გამოუცხადებლობა) — მომხმარებელს არაფერი ეზღუდება.',
          placeholder: 'მაგ: ხშირად არ ცხადდება ჯავშანზე',
          yes: 'მონიშვნა',
        } as ReasonDialogData,
      })
      .pipe(
        take(1),
        filter((reason): reason is string => !!reason),
        switchMap((reason) => this.customersService.flag(this.id(), reason)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (moderation) => {
          this.patchModeration(moderation);
          this.toast(tr('მომხმარებელი მოინიშნა'), 'success');
        },
        error: () => this.toast(tr('მონიშვნა ვერ მოხერხდა'), 'error'),
      });
  }

  protected unflag(): void {
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('მონიშვნის მოხსნა'),
        size: 's',
        data: {
          content: tr('მოვხსნათ მონიშვნა?'),
          yes: tr('მოხსნა'),
          no: tr('გაუქმება'),
        } as SsConfirmData,
      })
      .pipe(
        take(1),
        filter(Boolean),
        switchMap(() => this.customersService.unflag(this.id())),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (moderation) => {
          this.patchModeration(moderation);
          this.toast(tr('მონიშვნა მოხსნილია'), 'success');
        },
        error: () => this.toast(tr('მოხსნა ვერ მოხერხდა'), 'error'),
      });
  }

  /** Superadmin-only: a plain admin may not edit a player's name or phone. */
  protected editContact(): void {
    const detail = this.detail();
    if (!detail || !this.isSuperAdmin()) return;
    this.dialogs
      .open<Parameters<CustomersService['fixContact']>[1] | null>(
        ContactDialogComponent,
        {
          label: tr('მონაცემების შესწორება'),
          size: 'm',
          dismissible: true,
          closable: true,
          data: {
            profile: detail.profile,
            allowEmail: this.isSuperAdmin(),
          } as ContactDialogData,
        },
      )
      .pipe(
        take(1),
        filter((dto): dto is NonNullable<typeof dto> => !!dto),
        switchMap((dto) => this.customersService.fixContact(this.id(), dto)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast(tr('მონაცემები განახლდა'), 'success');
          // Reload: the profile AND the audit trail both changed.
          this.load();
        },
        error: () => this.toast(tr('შენახვა ვერ მოხერხდა'), 'error'),
      });
  }

  /** Superadmin: deep-link into the full account surface (email/password/balance). */
  protected openFullAccount(): void {
    const email = this.detail()?.profile.email;
    if (!email) return;
    void this.router.navigate(['/super-admin/user-management'], {
      queryParams: { email },
    });
  }

  private patchModeration(
    moderation: CustomerDetail['moderation'],
  ): void {
    const current = this.detail();
    if (current) this.detail.set({ ...current, moderation });
  }

  private toast(message: string, appearance: 'success' | 'error'): void {
    this.alerts.open(message, { appearance }).pipe(take(1)).subscribe();
  }

  // ── display helpers ────────────────────────────────────────────────────────

  protected fullName(): string {
    const p = this.detail()?.profile;
    if (!p) return '';
    const parts = [p.firstName, p.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : p.email;
  }

  /** Public member ID, zero-padded ("000042"); '' until the API backfill runs. */
  protected memberId(): string {
    return formatMemberId(this.detail()?.profile.memberId);
  }

  protected initials(): string {
    const p = this.detail()?.profile;
    if (!p) return '';
    const first = p.firstName?.charAt(0) ?? '';
    const last = p.lastName?.charAt(0) ?? '';
    return (first + last).toUpperCase() || p.email.charAt(0).toUpperCase();
  }

  protected gel(tetri: number | null | undefined): string {
    if (tetri == null) return '—';
    return `${new Intl.NumberFormat('ka-GE', { maximumFractionDigits: 2 }).format(tetri / 100)} ₾`;
  }

  protected pct(rate: number | null | undefined): string {
    if (rate == null) return '—';
    return `${new Intl.NumberFormat('ka-GE', { maximumFractionDigits: 1 }).format(rate * 100)}%`;
  }

  protected num(value: number | null | undefined): string {
    return value == null ? '—' : String(value);
  }

  protected statusBadgeClass(status: string): string {
    switch (status) {
      case 'confirmed':
        return 'ss-badge ss-badge--positive';
      case 'cancelled':
        return 'ss-badge ss-badge--negative';
      default:
        return 'ss-badge';
    }
  }

  /** RAW Georgian — the template renders it through `| t`. */
  protected paymentLabel(row: CustomerBookingRow): string {
    switch (row.paymentStatus) {
      case 'paid':
        return row.paymentMethod === 'card'
          ? 'გადახდილი (ბარათი)'
          : row.paymentMethod === 'balance'
            ? 'გადახდილი (ბალანსი)'
            : // The waterfall rail: voucher/balance covered part, a card the rest.
              row.paymentMethod === 'split'
              ? 'გადახდილი (ბალანსი + ბარათი)'
              : 'გადახდილი';
      case 'refunded':
        return 'დაბრუნებული';
      case 'processing':
        return 'მუშავდება';
      default:
        return 'ადგილზე გადახდა';
    }
  }
}
