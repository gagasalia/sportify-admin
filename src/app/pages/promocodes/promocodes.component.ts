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
import { AcademySelectComponent } from '../../shared/ui/academy-select.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, filter, switchMap, take } from 'rxjs';
import { PromocodeService } from '../../services/http-services/promocode.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { Academy } from '../../shared/models/academy.model';
import {
  ELIGIBILITY_LABELS,
  PROMO_STATUS_CLASSES,
  PROMO_STATUS_LABELS,
  PromoDerivedStatus,
  Promocode,
} from '../../shared/models/promocode.model';
import { tetriToGel } from '../../shared/utils/money.util';
import { tr } from '../../shared/i18n/lang';
import { TPipe } from '../../shared/i18n/t.pipe';
import { SsToastService } from '../../shared/ui/toast.service';
import { SsDialogService } from '../../shared/ui/dialog.service';
import { SsConfirmComponent, SsConfirmData } from '../../shared/ui/confirm.component';
import { PromocodeFormComponent } from './promocode-form/promocode-form.component';
import { PromoRedemptionsDialogComponent } from './promo-redemptions-dialog/promo-redemptions-dialog.component';

const PAGE_SIZE = 20;

/**
 * პრომოკოდები — the operator's promocode list: searchable, filterable by
 * active state (plus an academy select for superadmins), with inline
 * activate/deactivate switches, a create/edit dialog, a per-code redemptions
 * dialog, and delete for never-used codes (used codes are retired via the
 * switch instead).
 */
@Component({
  selector: 'app-promocodes',
  standalone: true,
  imports: [CommonModule, FormsModule, AcademySelectComponent, TPipe],
  templateUrl: './promocodes.component.html',
  styleUrl: './promocodes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromocodesComponent implements OnInit {
  private readonly promocodeService = inject(PromocodeService);
  private readonly academyService = inject(AcademyService);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSuperAdmin = this.auth.isSuperAdmin;

  // filters
  protected readonly q = signal('');
  protected readonly activeFilter = signal<boolean | null>(null);
  protected readonly academies = signal<Academy[]>([]);
  protected readonly academyId = signal<string>('');

  // list state
  protected readonly rows = signal<Promocode[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly hasError = signal(false);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly limit = PAGE_SIZE;
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit)),
  );
  protected readonly isMobile = signal(window.innerWidth <= 768);

  /** Drops stale responses when the user types faster than the API answers. */
  private requestSeq = 0;
  private readonly search$ = new Subject<void>();

  @HostListener('window:resize')
  protected onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  ngOnInit(): void {
    this.search$
      .pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.page.set(1);
        this.load();
      });

    if (this.isSuperAdmin()) {
      this.academyService
        .getAllAcademies()
        .pipe(take(1))
        .subscribe((academies) => this.academies.set(academies));
    }

    this.tenant
      .ensure()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
  }

  // ── filters ────────────────────────────────────────────────────────────────

  protected onSearchChange(value: string): void {
    this.q.set(value);
    this.search$.next();
  }

  protected setActiveFilter(active: boolean | null): void {
    this.activeFilter.set(active);
    this.page.set(1);
    this.load();
  }

  protected onAcademyChange(academyId: string): void {
    this.academyId.set(academyId);
    this.page.set(1);
    this.load();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected retry(): void {
    this.load();
  }

  private load(): void {
    const seq = ++this.requestSeq;
    this.isLoading.set(true);
    this.hasError.set(false);
    this.promocodeService
      .getPromocodes({
        page: this.page(),
        limit: this.limit,
        q: this.q().trim() || undefined,
        active: this.activeFilter() ?? undefined,
        academyId: this.academyId() || undefined,
      })
      .pipe(take(1))
      .subscribe({
        next: ({ data, page }) => {
          if (seq !== this.requestSeq) return;
          this.rows.set(data);
          this.total.set(page?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: () => {
          if (seq !== this.requestSeq) return;
          this.isLoading.set(false);
          this.hasError.set(true);
        },
      });
  }

  // ── dialogs ────────────────────────────────────────────────────────────────

  protected addPromocode(): void {
    this.dialogs
      .open<Promocode | null>(PromocodeFormComponent, {
        label: tr('პრომოკოდის დამატება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: {},
      })
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.load();
          this.alerts.open(tr('შეიქმნა'), { appearance: 'success' }).pipe(take(1)).subscribe();
        }
      });
  }

  protected editPromocode(promo: Promocode): void {
    this.dialogs
      .open<Promocode | null>(PromocodeFormComponent, {
        label: tr('პრომოკოდის რედაქტირება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: { promocode: promo },
      })
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.load();
          this.alerts.open(tr('შეინახა'), { appearance: 'success' }).pipe(take(1)).subscribe();
        }
      });
  }

  protected openRedemptions(promo: Promocode): void {
    this.dialogs
      .open<void>(PromoRedemptionsDialogComponent, {
        label: `${tr('გამოყენებები')} · ${promo.code}`,
        size: 'l',
        dismissible: true,
        closable: true,
        data: { promocode: promo },
      })
      .pipe(take(1))
      .subscribe();
  }

  protected deletePromocode(promo: Promocode): void {
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('პრომოკოდის წაშლა'),
        size: 's',
        data: {
          content: `${tr('ნამდვილად წავშალოთ პრომოკოდი')} „${promo.code}"?`,
          yes: tr('წაშლა'),
          no: tr('გაუქმება'),
          appearance: 'destructive',
        } as SsConfirmData,
      })
      .pipe(
        take(1),
        filter(Boolean),
        switchMap(() => this.promocodeService.deletePromocode(promo._id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.load();
          this.alerts.open(tr('წაიშალა'), { appearance: 'success' }).pipe(take(1)).subscribe();
        },
        error: () => {
          this.alerts
            .open(tr('წაშლა ვერ მოხერხდა, სცადეთ თავიდან'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  // ── inline active switch ───────────────────────────────────────────────────

  /** Optimistic flip: the row updates immediately and reverts on error. */
  protected onActiveToggle(promo: Promocode, active: boolean): void {
    if (promo.active === active) return;
    const previous = promo.active;
    this.rows.update((list) =>
      list.map((p) => (p._id === promo._id ? { ...p, active } : p)),
    );
    this.promocodeService
      .updatePromocode(promo._id, { active })
      .pipe(take(1))
      .subscribe({
        next: (updated) => {
          this.rows.update((list) =>
            list.map((p) => (p._id === updated._id ? updated : p)),
          );
          this.alerts.open(tr('შეინახა'), { appearance: 'success' }).pipe(take(1)).subscribe();
        },
        error: () => {
          this.rows.update((list) =>
            list.map((p) => (p._id === promo._id ? { ...p, active: previous } : p)),
          );
          this.alerts
            .open(tr('შენახვა ვერ მოხერხდა, სცადეთ თავიდან'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  // ── display helpers ────────────────────────────────────────────────────────

  /**
   * Derive the display status: inactive → expired → scheduled → depleted →
   * active. A date-only `expiresAt` counts to the END of that day (matching
   * the server's interpretation).
   */
  protected derivedStatus(p: Promocode): PromoDerivedStatus {
    if (!p.active) return 'inactive';
    if (p.expiresAt && this.expiryTime(p.expiresAt) <= Date.now()) return 'expired';
    if (p.startsAt && new Date(p.startsAt).getTime() > Date.now()) return 'scheduled';
    if (p.usageLimitTotal != null && p.usedCount >= p.usageLimitTotal) return 'depleted';
    return 'active';
  }

  private expiryTime(expiresAt: string): number {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt);
    return new Date(dateOnly ? `${expiresAt}T23:59:59.999` : expiresAt).getTime();
  }

  protected statusLabel(status: PromoDerivedStatus): string {
    return PROMO_STATUS_LABELS[status] ?? status;
  }

  protected statusClass(status: PromoDerivedStatus): string {
    return PROMO_STATUS_CLASSES[status] ?? PROMO_STATUS_CLASSES.inactive;
  }

  protected discountLabel(p: Promocode): string {
    return p.discountType === 'percent'
      ? `−${p.percentOff ?? 0}%`
      : `−${tetriToGel(p.amountTetri ?? 0)} ₾`;
  }

  /** 'მაქს. X ₾' cap hint for capped percent discounts, or null. */
  protected maxDiscountHint(p: Promocode): string | null {
    return p.discountType === 'percent' && p.maxDiscountTetri != null
      ? `${tr('მაქს.')} ${tetriToGel(p.maxDiscountTetri)} ₾`
      : null;
  }

  protected eligibilityLabel(p: Promocode): string {
    if (p.eligibility === 'booking_count_range') {
      const min = p.minBookings ?? 0;
      const bookings = tr('ჯავშანი');
      return p.maxBookings != null
        ? `${min}–${p.maxBookings} ${bookings}`
        : `${min}+ ${bookings}`;
    }
    return ELIGIBILITY_LABELS[p.eligibility] ?? p.eligibility;
  }

  /** 'DD.MM.YY – DD.MM.YY' validity window, or 'უვადო' when unbounded. */
  protected windowLabel(p: Promocode): string {
    if (!p.startsAt && !p.expiresAt) return tr('უვადო');
    const from = p.startsAt ? this.fmtDate(p.startsAt) : '…';
    const to = p.expiresAt ? this.fmtDate(p.expiresAt) : '…';
    return `${from} – ${to}`;
  }

  private fmtDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : value;
  }

  protected usageLabel(p: Promocode): string {
    return `${p.usedCount} / ${p.usageLimitTotal != null ? p.usageLimitTotal : '∞'}`;
  }
}
