import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AcademySelectComponent } from '../../shared/ui/academy-select.component';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { forkJoin, take } from 'rxjs';
import { VoucherService } from '../../services/http-services/voucher.service';
import { FacilityService } from '../../services/http-services/facility.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { liveLabels, tr } from '../../shared/i18n/lang';
import { localizedName, localizedText } from '../../shared/i18n/localized';
import { TPipe } from '../../shared/i18n/t.pipe';
import { gelToTetri, tetriToGel } from '../../shared/utils/money.util';
import { formatMemberId } from '../../shared/utils/member-id.util';
import { Academy } from '../../shared/models/academy.model';
import { Facility } from '../../shared/models/facility.model';
import {
  GrantVoucherDto,
  ImportEntry,
  PendingGrant,
  Voucher,
  VoucherDerivedStatus,
  VoucherScopeQuery,
  VoucherSource,
  isVoucher,
} from '../../shared/models/voucher.model';

import { SsToastService } from '../../shared/ui/toast.service';
/** Result of parsing the bulk-import textarea: valid entries + per-line errors. */
interface ParsedImport {
  entries: ImportEntry[];
  errors: string[];
}

/**
 * The page's selected scope — mirrors the API's one-scope-per-request rule:
 * a facility chip, the "whole academy" chip (academy-WIDE vouchers), or the
 * universal pool (superadmin with no academy picked).
 */
type ScopeSelection =
  | { kind: 'facility'; facilityId: string }
  | { kind: 'academy'; academyId: string }
  | { kind: 'universal' };

/** Phone as the admin may type it: optional +, 9–15 digits (spaces/dashes stripped). */
const PHONE_RE = /^\+?\d{9,15}$/;

/**
 * Admin voucher page (design section 21.6). Taiga-free (ss-* kit): a scope
 * chip rail — facility chips plus a "whole academy" chip, first facility
 * selected by default (?facilityId= / ?scope=academy override) — gates three
 * blocks: a single grant form, a bulk-import textarea, and two tables
 * (scope vouchers + pending grants). A superadmin gets an academy select
 * instead of the tenant academy; leaving it empty targets the UNIVERSAL pool
 * (platform-wide vouchers). Expiry dates use native date inputs ('YYYY-MM-DD'
 * strings). Amounts are entered/shown in GEL and converted to integer tetri at
 * the wire edge. SsToastService remains for toasts until the kit grows its own
 * (machinery is the last migration phase).
 */
@Component({
  selector: 'app-vouchers',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, AcademySelectComponent, TPipe],
  templateUrl: './vouchers.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VouchersComponent implements OnInit {
  private readonly voucherService = inject(VoucherService);
  private readonly facilityService = inject(FacilityService);
  private readonly academyService = inject(AcademyService);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly alerts = inject(SsToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSuperAdmin = this.auth.isSuperAdmin;

  // scope selection
  readonly academies = signal<Academy[]>([]); // superadmin select
  readonly selectedAcademyId = signal<string>(''); // '' = universal (superadmin)
  readonly facilities = signal<Facility[]>([]);
  readonly selectedScope = signal<ScopeSelection | null>(null);

  readonly isFacilitySelected = (f: Facility): boolean => {
    const scope = this.selectedScope();
    return scope?.kind === 'facility' && scope.facilityId === this.facilityIdOf(f);
  };
  readonly isAcademyScopeSelected = computed(() => this.selectedScope()?.kind === 'academy');

  // lists (each paginated independently — imports can make both grow)
  readonly vouchers = signal<Voucher[]>([]);
  readonly grants = signal<PendingGrant[]>([]);
  readonly vouchersPage = signal(1);
  readonly vouchersTotal = signal(0);
  readonly grantsPage = signal(1);
  readonly grantsTotal = signal(0);
  readonly listLimit = 20;
  readonly vouchersPages = computed(() =>
    Math.max(1, Math.ceil(this.vouchersTotal() / this.listLimit)),
  );
  readonly grantsPages = computed(() =>
    Math.max(1, Math.ceil(this.grantsTotal() / this.listLimit)),
  );

  // ui state
  readonly isLoading = signal(false);
  readonly hasError = signal(false);
  readonly grantSubmitting = signal(false);
  readonly importSubmitting = signal(false);
  readonly importErrors = signal<string[]>([]);

  // grant form — expiresAt is a native-date 'YYYY-MM-DD' string ('' = none)
  readonly grantForm = new FormGroup({
    phone: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, VouchersComponent.phoneValidator],
    }),
    amountGel: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    expiresAt: new FormControl<string>('', { nonNullable: true }),
    note: new FormControl<string>('', { nonNullable: true }),
  });

  // import form
  readonly importControl = new FormControl<string>('', { nonNullable: true });
  readonly importExpiry = new FormControl<string>('', { nonNullable: true });

  // RAW Georgian values behind `liveLabels` — every read translates on the fly,
  // so a language flip re-renders the chips instead of leaving them stale.
  readonly statusLabels: Record<VoucherDerivedStatus, string> = liveLabels({
    active: 'აქტიური',
    depleted: 'ამოწურული',
    expired: 'ვადაგასული',
    pending_activation: 'ელოდება აქტივაციას',
    revoked: 'გაუქმებული',
  });

  readonly sourceLabels: Record<VoucherSource, string> = liveLabels({
    migration: 'მიგრაცია',
    admin_grant: 'გრანტი',
    purchase: 'ყიდვა',
    gift: 'საჩუქარი',
    campaign: 'კამპანია',
  });

  private static phoneValidator(control: AbstractControl): ValidationErrors | null {
    const normalized = String(control.value ?? '').replace(/[\s-]/g, '');
    return !normalized || PHONE_RE.test(normalized) ? null : { phone: true };
  }

  private facilityIdOf(f: Facility): string | null {
    return f._id ?? f.id ?? null;
  }

  facilityLabel(f: Facility): string {
    return (
      localizedName(f) || localizedText(f.description, f.descriptionEn) || tr('უსახელო ობიექტი')
    );
  }

  ngOnInit(): void {
    if (this.isSuperAdmin()) {
      // Superadmin: academy select instead of the tenant academy; no academy
      // picked = the universal (platform-wide) pool.
      this.academyService
        .getAllAcademies()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (academies) => this.academies.set(academies ?? []),
          error: () => this.hasError.set(true),
        });
      this.selectScope({ kind: 'universal' });
      return;
    }
    this.tenant
      .ensure()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadFacilities());
  }

  /** The academy whose scopes the rail currently shows (tenant or picked). */
  private railAcademyId(): string | null {
    return this.isSuperAdmin() ? this.selectedAcademyId() || null : this.tenant.academyId();
  }

  // facility resolution (mirrors the reservations page)
  private loadFacilities(): void {
    const academyId = this.railAcademyId();
    if (!academyId) {
      this.facilities.set([]);
      this.selectScope(this.isSuperAdmin() ? { kind: 'universal' } : null);
      return;
    }
    this.facilityService
      .getFacilitiesByAcademy(academyId)
      .pipe(take(1))
      .subscribe({
        next: (facilities) => {
          this.facilities.set(facilities);
          this.resolveSelection(facilities, academyId);
        },
        error: () => this.hasError.set(true),
      });
  }

  /**
   * Admin default: the first facility chip; `?facilityId=` / `?scope=academy`
   * override. Superadmin lands on the "whole academy" chip after picking an
   * academy (query params are not persisted for the superadmin select,
   * mirroring the promocodes filter).
   */
  private resolveSelection(facilities: Facility[], academyId: string): void {
    if (this.isSuperAdmin()) {
      this.selectScope({ kind: 'academy', academyId });
      return;
    }
    this.route.queryParams.pipe(take(1)).subscribe((params) => {
      if (params['scope'] === 'academy') {
        this.selectScope({ kind: 'academy', academyId });
        return;
      }
      if (facilities.length === 0) {
        this.selectScope({ kind: 'academy', academyId });
        return;
      }
      const fromQuery = params['facilityId'];
      const match = facilities.find((f) => this.facilityIdOf(f) === fromQuery);
      const fId = match ? this.facilityIdOf(match) : this.facilityIdOf(facilities[0]);
      if (fromQuery !== fId) this.updateQueryParams(fId);
      this.selectScope(fId ? { kind: 'facility', facilityId: fId } : { kind: 'academy', academyId });
    });
  }

  onFacilityChipClick(facility: Facility): void {
    const fId = this.facilityIdOf(facility);
    if (!fId || this.isFacilitySelected(facility)) return;
    if (!this.isSuperAdmin()) this.updateQueryParams(fId);
    this.selectScope({ kind: 'facility', facilityId: fId });
  }

  onAcademyChipClick(): void {
    const academyId = this.railAcademyId();
    if (!academyId || this.selectedScope()?.kind === 'academy') return;
    if (!this.isSuperAdmin()) this.updateQueryParams(null, 'academy');
    this.selectScope({ kind: 'academy', academyId });
  }

  /** Superadmin academy select: '' = the universal (platform-wide) pool. */
  onAcademyChange(academyId: string): void {
    this.selectedAcademyId.set(academyId);
    if (!academyId) {
      this.facilities.set([]);
      this.selectScope({ kind: 'universal' });
      return;
    }
    this.loadFacilities();
  }

  private selectScope(scope: ScopeSelection | null): void {
    this.selectedScope.set(scope);
    this.vouchers.set([]);
    this.grants.set([]);
    this.vouchersPage.set(1);
    this.vouchersTotal.set(0);
    this.grantsPage.set(1);
    this.grantsTotal.set(0);
    this.importErrors.set([]);
    if (scope) {
      this.loadLists(this.scopeQuery(scope));
    }
  }

  /** The wire shape of a scope: facilityId, academyId, or neither (universal). */
  private scopeQuery(scope: ScopeSelection): VoucherScopeQuery {
    if (scope.kind === 'facility') return { facilityId: scope.facilityId };
    if (scope.kind === 'academy') return { academyId: scope.academyId };
    return {};
  }

  private updateQueryParams(facilityId: string | null, scope?: 'academy'): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { facilityId: facilityId || null, scope: scope ?? null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private loadLists(scope: VoucherScopeQuery): void {
    this.isLoading.set(true);
    this.hasError.set(false);
    // A hard failure of either list surfaces the error banner (the reservations
    // pattern); a successful pair replaces both signals atomically.
    forkJoin({
      vouchers: this.voucherService.getVouchers(scope, this.vouchersPage(), this.listLimit),
      grants: this.voucherService.getGrants(scope, this.grantsPage(), this.listLimit),
    })
      .pipe(take(1))
      .subscribe({
        next: ({ vouchers, grants }) => {
          this.vouchers.set(vouchers.data);
          this.vouchersTotal.set(vouchers.page?.total ?? vouchers.data.length);
          this.grants.set(grants.data);
          this.grantsTotal.set(grants.page?.total ?? grants.data.length);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.hasError.set(true);
        },
      });
  }

  onVouchersPageChange(page: number): void {
    this.vouchersPage.set(page);
    this.refreshLists();
  }

  onGrantsPageChange(page: number): void {
    this.grantsPage.set(page);
    this.refreshLists();
  }

  /** Fresh writes land on top of page 1 — jump back so they are visible. */
  private refreshLists(resetToFirstPage = false): void {
    if (resetToFirstPage) {
      this.vouchersPage.set(1);
      this.grantsPage.set(1);
    }
    const scope = this.selectedScope();
    if (scope) this.loadLists(this.scopeQuery(scope));
  }

  // grant
  submitGrant(): void {
    const scope = this.selectedScope();
    if (!scope || this.grantForm.invalid) {
      this.grantForm.markAllAsTouched();
      return;
    }
    const { phone, amountGel, expiresAt, note } = this.grantForm.getRawValue();
    const dto: GrantVoucherDto = {
      ...this.scopeQuery(scope),
      phone: phone.replace(/[\s-]/g, ''),
      amountTetri: gelToTetri(amountGel ?? 0),
    };
    if (expiresAt) dto.expiresAt = expiresAt;
    if (note.trim()) dto.note = note.trim();

    this.grantSubmitting.set(true);
    this.voucherService
      .grant(dto)
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.grantSubmitting.set(false);
          if (isVoucher(result)) {
            this.alerts.open(tr('მიენიჭა'), { appearance: 'success' }).pipe(take(1)).subscribe();
          } else {
            this.alerts
              .open(tr('მოლოდინში დაემატა'), { appearance: 'info' })
              .pipe(take(1))
              .subscribe();
          }
          this.resetGrantForm();
          this.refreshLists(true);
        },
        error: () => {
          this.grantSubmitting.set(false);
          this.alerts
            .open(tr('შეცდომა მინიჭებისას.'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  private resetGrantForm(): void {
    this.grantForm.reset({ phone: '', amountGel: null, expiresAt: '', note: '' });
  }

  // bulk import
  /**
   * Parse the `phone,amountGel` textarea. Blank lines are ignored; every other
   * line must be exactly two comma-separated fields with a valid phone and a
   * positive amount. Returns valid entries (amount already in tetri) alongside a
   * Georgian error per malformed line (1-based line numbers).
   */
  parseImport(text: string): ParsedImport {
    const entries: ImportEntry[] = [];
    const errors: string[] = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (!line) return;
      const n = index + 1;
      const parts = line.split(',');
      if (parts.length !== 2) {
        errors.push(`${tr('ხაზი')} ${n}: ${tr('არასწორი ფორმატი')}`);
        return;
      }
      const phone = parts[0].replace(/[\s-]/g, '');
      const amount = Number(parts[1].trim());
      if (!PHONE_RE.test(phone)) {
        errors.push(`${tr('ხაზი')} ${n}: ${tr('არასწორი ტელეფონი')}`);
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        errors.push(`${tr('ხაზი')} ${n}: ${tr('არასწორი თანხა')}`);
        return;
      }
      entries.push({ phone, amountTetri: gelToTetri(amount) });
    });
    return { entries, errors };
  }

  submitImport(): void {
    const scope = this.selectedScope();
    if (!scope) return;
    const { entries, errors } = this.parseImport(this.importControl.value ?? '');
    if (errors.length > 0) {
      this.importErrors.set(errors);
      return;
    }
    if (entries.length === 0) {
      // RAW Georgian — the template renders importErrors through `| t`.
      this.importErrors.set(['სია ცარიელია']);
      return;
    }
    this.importErrors.set([]);
    const expiresAt = this.importExpiry.value || undefined;

    this.importSubmitting.set(true);
    this.voucherService
      .import(this.scopeQuery(scope), entries, expiresAt)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          this.importSubmitting.set(false);
          this.alerts
            .open(`${tr('მიენიჭა')} ${res.granted} · ${tr('მოლოდინში')} ${res.pending}`, {
              appearance: 'success',
            })
            .pipe(take(1))
            .subscribe();
          this.importControl.reset('');
          this.importExpiry.reset('');
          this.refreshLists(true);
        },
        error: () => {
          this.importSubmitting.set(false);
          this.alerts
            .open(tr('შეცდომა იმპორტისას.'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  // table display helpers
  /** Derive the display status: revoked -> pending -> depleted -> expired -> active. */
  derivedStatus(v: Voucher): VoucherDerivedStatus {
    if (v.status === 'revoked') return 'revoked';
    if (v.status === 'pending_activation') return 'pending_activation';
    if (v.balanceTetri <= 0) return 'depleted';
    if (v.expiresAt && new Date(v.expiresAt).getTime() <= Date.now()) return 'expired';
    return 'active';
  }

  /** ss-badge modifier class for a derived voucher status. */
  statusBadgeClass(status: VoucherDerivedStatus): string {
    switch (status) {
      case 'active':
        return 'ss-badge ss-badge--positive';
      case 'depleted':
        return 'ss-badge ss-badge--neutral';
      case 'expired':
        return 'ss-badge ss-badge--negative';
      case 'pending_activation':
        return 'ss-badge ss-badge--warning';
      case 'revoked':
        return 'ss-badge ss-badge--negative';
    }
  }

  balanceGel(v: Voucher): number {
    return tetriToGel(v.balanceTetri);
  }

  initialGel(v: Voucher): number {
    return tetriToGel(v.initialTetri);
  }

  grantAmountGel(g: PendingGrant): number {
    return tetriToGel(g.amountTetri);
  }

  /** `expiresAt` as a plain YYYY-MM-DD, or a dash when the voucher never expires. */
  expiryLabel(expiresAt?: string | null): string {
    return expiresAt ? expiresAt.slice(0, 10) : '—';
  }

  ownerLabel(v: Voucher): string {
    // "000042 · +9955…" once the member ID exists; phone/raw-id fallbacks keep
    // legacy rows readable.
    const id = formatMemberId(v.ownerMemberId);
    if (id && v.ownerPhone) return `${id} · ${v.ownerPhone}`;
    return id || v.ownerPhone || v.owner || '—';
  }

  navigateToFacilities(): void {
    this.router.navigate(['/configuration/facilities']);
  }
}
