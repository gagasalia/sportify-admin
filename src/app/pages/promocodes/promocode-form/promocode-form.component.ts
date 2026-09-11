import { AcademySelectComponent } from '../../../shared/ui/academy-select.component';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs';
import { PromocodeService } from '../../../services/http-services/promocode.service';
import { AcademyService } from '../../../services/http-services/academy.service';
import { AuthService } from '../../../shared/services/auth.service';
import { Academy } from '../../../shared/models/academy.model';
import {
  CreatePromocodeDto,
  PROMO_CODE_RE,
  ELIGIBILITY_LABELS,
  PromoDiscountType,
  PromoEligibility,
  Promocode,
  UpdatePromocodeDto,
} from '../../../shared/models/promocode.model';
import { gelToTetri, tetriToGel } from '../../../shared/utils/money.util';
import { liveLabels, tr } from '../../../shared/i18n/lang';
import { TPipe } from '../../../shared/i18n/t.pipe';
import { SsToastService } from '../../../shared/ui/toast.service';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../../shared/ui/dialog.service';

// RAW Georgian behind `liveLabels` — translated on read, never baked.
export const DISCOUNT_TYPE_LABELS: Record<PromoDiscountType, string> = liveLabels({
  percent: 'პროცენტული',
  fixed: 'ფიქსირებული',
});

/** The raw shape of the promocode form (GEL at the edges, tetri on the wire). */
interface PromoFormValue {
  code: string;
  name: string;
  discountType: PromoDiscountType;
  percentOff: number | null;
  maxDiscountGel: number | null;
  amountGel: number | null;
  minPriceGel: number | null;
  eligibility: PromoEligibility;
  minBookings: number | null;
  maxBookings: number | null;
  startsAt: string;
  expiresAt: string;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  active: boolean;
  academyId: string;
}

/**
 * Create/edit promocode dialog. Amounts are edited in GEL and cross the wire
 * as integer tetri. The code is immutable after creation; once a code has
 * been used the discount terms lock (the API 409s on changes) so those
 * controls disable with a hint. Superadmins pick an academy (or platform-wide)
 * at creation time; admins send no academy at all — the server scopes them.
 * In EDIT mode a cleared optional bound is sent as an explicit `null` so the
 * API unsets it.
 */
@Component({
  selector: 'app-promocode-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AcademySelectComponent, TPipe],
  templateUrl: './promocode-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromocodeFormComponent implements OnInit {
  form!: FormGroup;

  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    Promocode | null,
    { promocode?: Promocode }
  >;
  private readonly fb = inject(FormBuilder);
  private readonly promocodeService = inject(PromocodeService);
  private readonly academyService = inject(AcademyService);
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(SsToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSuperAdmin = this.auth.isSuperAdmin;

  protected readonly academies = signal<Academy[]>([]);
  protected readonly isSaving = signal(false);
  /** Mirrors of select controls for OnPush-friendly template branches. */
  protected readonly discountType = signal<PromoDiscountType>('percent');
  protected readonly eligibility = signal<PromoEligibility>('everyone');

  /** True when the code was already used — discount terms are API-locked. */
  protected discountLocked = false;

  protected readonly discountTypeOptions = Object.keys(
    DISCOUNT_TYPE_LABELS,
  ) as PromoDiscountType[];
  protected readonly eligibilityOptions = Object.keys(ELIGIBILITY_LABELS) as PromoEligibility[];

  protected readonly stringifyDiscountType = (v: PromoDiscountType): string =>
    DISCOUNT_TYPE_LABELS[v] ?? String(v);
  protected readonly stringifyEligibility = (v: PromoEligibility): string =>
    ELIGIBILITY_LABELS[v] ?? String(v);

  protected get isEditMode(): boolean {
    return !!this.context.data?.promocode;
  }

  ngOnInit(): void {
    const p = this.context.data?.promocode;
    this.discountLocked = !!p && p.usedCount > 0;

    this.form = this.fb.group({
      // The code is immutable once created; uppercased as the API expects.
      code: [
        { value: p?.code ?? '', disabled: this.isEditMode },
        [Validators.required, Validators.pattern(PROMO_CODE_RE)],
      ],
      name: [p?.name ?? ''],
      discountType: [
        { value: p?.discountType ?? 'percent', disabled: this.discountLocked },
        [Validators.required],
      ],
      percentOff: [{ value: p?.percentOff ?? null, disabled: this.discountLocked }],
      maxDiscountGel: [
        {
          value: p?.maxDiscountTetri != null ? tetriToGel(p.maxDiscountTetri) : null,
          disabled: this.discountLocked,
        },
      ],
      amountGel: [
        {
          value: p?.amountTetri != null ? tetriToGel(p.amountTetri) : null,
          disabled: this.discountLocked,
        },
      ],
      minPriceGel: [p?.minPriceTetri != null ? tetriToGel(p.minPriceTetri) : null],
      eligibility: [p?.eligibility ?? 'everyone', [Validators.required]],
      minBookings: [p?.minBookings ?? null],
      maxBookings: [p?.maxBookings ?? null],
      // Native date inputs bound to 'YYYY-MM-DD' strings ('' = no bound).
      startsAt: [p?.startsAt ? p.startsAt.slice(0, 10) : ''],
      expiresAt: [p?.expiresAt ? p.expiresAt.slice(0, 10) : ''],
      usageLimitTotal: [p?.usageLimitTotal ?? null],
      usageLimitPerUser: [p?.usageLimitPerUser ?? null],
      active: [p?.active ?? true],
      // Superadmin-only; '' = platform-wide. Scope is immutable after create.
      academyId: [{ value: p?.academy ?? '', disabled: this.isEditMode }],
    });

    this.discountType.set(p?.discountType ?? 'percent');
    this.eligibility.set(p?.eligibility ?? 'everyone');
    this.applyDiscountValidators(this.discountType());
    this.applyEligibilityValidators(this.eligibility());

    // Uppercase-as-you-type: the wire format is A–Z 0–9 dashes only.
    const codeCtrl = this.form.get('code')!;
    codeCtrl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: string | null) => {
        const upper = (value ?? '').toUpperCase();
        if (upper !== value) codeCtrl.setValue(upper, { emitEvent: false });
      });

    this.form
      .get('discountType')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type: PromoDiscountType) => {
        this.discountType.set(type);
        this.applyDiscountValidators(type);
      });

    this.form
      .get('eligibility')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((eligibility: PromoEligibility) => {
        this.eligibility.set(eligibility);
        this.applyEligibilityValidators(eligibility);
      });

    if (this.isSuperAdmin()) {
      this.academyService
        .getAllAcademies()
        .pipe(take(1))
        .subscribe((academies) => this.academies.set(academies));
    }
  }

  private applyDiscountValidators(type: PromoDiscountType): void {
    const percentOff = this.form.get('percentOff')!;
    const amountGel = this.form.get('amountGel')!;
    if (type === 'percent') {
      percentOff.setValidators([Validators.required, Validators.min(1), Validators.max(100)]);
      amountGel.clearValidators();
    } else {
      amountGel.setValidators([Validators.required, Validators.min(0.01)]);
      percentOff.clearValidators();
    }
    percentOff.updateValueAndValidity({ emitEvent: false });
    amountGel.updateValueAndValidity({ emitEvent: false });
  }

  private applyEligibilityValidators(eligibility: PromoEligibility): void {
    const minBookings = this.form.get('minBookings')!;
    if (eligibility === 'booking_count_range') {
      minBookings.setValidators([Validators.required, Validators.min(0)]);
    } else {
      minBookings.clearValidators();
    }
    minBookings.updateValueAndValidity({ emitEvent: false });
  }

  protected onSubmit(): void {
    if (this.form.invalid || this.isSaving()) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue() as PromoFormValue;

    this.isSaving.set(true);
    const request = this.isEditMode
      ? this.promocodeService.updatePromocode(
          this.context.data.promocode!._id,
          this.buildUpdateDto(v),
        )
      : this.promocodeService.createPromocode(this.buildCreateDto(v));

    request.pipe(take(1)).subscribe({
      next: (saved) => this.context.completeWith(saved),
      error: (err: HttpErrorResponse) => {
        this.isSaving.set(false);
        if (err.status === 409 && !this.isEditMode) {
          this.form.get('code')?.setErrors({ conflict: true });
          this.alerts
            .open(tr('ეს კოდი უკვე არსებობს'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
          return;
        }
        this.alerts
          .open(tr('შენახვა ვერ მოხერხდა, სცადეთ თავიდან'), { appearance: 'error' })
          .pipe(take(1))
          .subscribe();
      },
    });
  }

  /** CREATE: optional keys are included only when actually set. */
  private buildCreateDto(v: PromoFormValue): CreatePromocodeDto {
    const dto: CreatePromocodeDto = {
      code: v.code.trim().toUpperCase(),
      discountType: v.discountType,
      eligibility: v.eligibility,
      active: v.active,
    };
    if (v.name.trim()) dto.name = v.name.trim();
    if (v.discountType === 'percent') {
      dto.percentOff = v.percentOff!;
      if (v.maxDiscountGel != null) dto.maxDiscountTetri = gelToTetri(v.maxDiscountGel);
    } else {
      dto.amountTetri = gelToTetri(v.amountGel!);
    }
    if (v.minPriceGel != null) dto.minPriceTetri = gelToTetri(v.minPriceGel);
    if (v.eligibility === 'booking_count_range') {
      dto.minBookings = v.minBookings!;
      if (v.maxBookings != null) dto.maxBookings = v.maxBookings;
    }
    if (v.startsAt) dto.startsAt = v.startsAt;
    if (v.expiresAt) dto.expiresAt = v.expiresAt;
    if (v.usageLimitTotal != null) dto.usageLimitTotal = v.usageLimitTotal;
    if (v.usageLimitPerUser != null) dto.usageLimitPerUser = v.usageLimitPerUser;
    if (this.isSuperAdmin() && v.academyId) dto.academyId = v.academyId;
    return dto;
  }

  /**
   * EDIT: cleared optional bounds go over as explicit `null` so the API unsets
   * them. Discount terms are skipped entirely once the code has been used
   * (they are locked server-side and would 409).
   */
  private buildUpdateDto(v: PromoFormValue): UpdatePromocodeDto {
    const dto: UpdatePromocodeDto = {
      name: v.name.trim() || null,
      eligibility: v.eligibility,
      active: v.active,
      minPriceTetri: v.minPriceGel != null ? gelToTetri(v.minPriceGel) : null,
      startsAt: v.startsAt || null,
      expiresAt: v.expiresAt || null,
      usageLimitTotal: v.usageLimitTotal ?? null,
      usageLimitPerUser: v.usageLimitPerUser ?? null,
    };
    if (v.eligibility === 'booking_count_range') {
      dto.minBookings = v.minBookings!;
      dto.maxBookings = v.maxBookings ?? null;
    } else {
      dto.minBookings = null;
      dto.maxBookings = null;
    }
    if (!this.discountLocked) {
      dto.discountType = v.discountType;
      if (v.discountType === 'percent') {
        dto.percentOff = v.percentOff!;
        dto.maxDiscountTetri = v.maxDiscountGel != null ? gelToTetri(v.maxDiscountGel) : null;
        dto.amountTetri = null;
      } else {
        dto.amountTetri = gelToTetri(v.amountGel!);
        dto.percentOff = null;
        dto.maxDiscountTetri = null;
      }
    }
    return dto;
  }

  protected cancel(): void {
    this.context.completeWith(null);
  }
}
