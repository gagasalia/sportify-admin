import { AcademySelectComponent } from '../../../shared/ui/academy-select.component';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs';
import { CampaignService } from '../../../services/http-services/campaign.service';
import { AcademyService } from '../../../services/http-services/academy.service';
import { FacilityService } from '../../../services/http-services/facility.service';
import { AuthService } from '../../../shared/services/auth.service';
import { TenantService } from '../../../shared/services/tenant.service';
import { Academy } from '../../../shared/models/academy.model';
import {
  Campaign,
  CampaignGoalType,
  CreateCampaignDto,
  GOAL_TYPE_LABELS,
  UpdateCampaignDto,
} from '../../../shared/models/campaign.model';
import { gelToTetri, tetriToGel } from '../../../shared/utils/money.util';
import { tr } from '../../../shared/i18n/lang';
import { TPipe } from '../../../shared/i18n/t.pipe';
import { SsToastService } from '../../../shared/ui/toast.service';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../../shared/ui/dialog.service';

/** One venue option in the scope multiselect. */
interface FacilityOption {
  _id: string;
  name: string;
}

/** The raw shape of the campaign form (GEL at the edges, tetri on the wire). */
interface CampaignFormValue {
  goalType: CampaignGoalType;
  /** A COUNT for bookings, a GEL amount for spend — split for validation. */
  goalCount: number | null;
  goalGel: number | null;
  rewardGel: number | null;
  rewardValidDays: number | null;
  maxCompletionsPerUser: number | null;
  startsAt: string;
  endsAt: string;
  active: boolean;
  academyId: string;
}

/**
 * Create/edit campaign dialog (docs/24 §5.1, v2).
 *
 * A campaign is ONLY its terms: goal, reward, scope, period. There is no copy
 * to write (the sentence the player reads is GENERATED — the live preview on
 * top shows exactly it) and no icon to pick (always the gift). The campaign's
 * end date IS the deadline every player shares.
 *
 * Amounts are edited in GEL and cross the wire as integer tetri. Once anyone
 * has joined, the TERMS (goal / reward) lock — the API 409s on changes — so
 * those controls disable with a hint; the end date stays editable (extending
 * it gives every chaser more time). Superadmins pick an academy (or
 * platform-wide) at creation; admins send none and are scoped server-side.
 */
@Component({
  selector: 'app-campaign-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AcademySelectComponent, TPipe],
  templateUrl: './campaign-form.component.html',
  styleUrl: './campaign-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CampaignFormComponent implements OnInit {
  form!: FormGroup;

  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    Campaign | null,
    { campaign?: Campaign }
  >;
  private readonly fb = inject(FormBuilder);
  private readonly campaignService = inject(CampaignService);
  private readonly academyService = inject(AcademyService);
  private readonly facilityService = inject(FacilityService);
  private readonly tenant = inject(TenantService);
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(SsToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSuperAdmin = this.auth.isSuperAdmin;

  protected readonly academies = signal<Academy[]>([]);
  protected readonly facilities = signal<FacilityOption[]>([]);
  protected readonly isSaving = signal(false);

  /** Mirrors of the controls the live preview + conditional fields read. */
  protected readonly goalType = signal<CampaignGoalType>('bookings');
  protected readonly selectedFacilityIds = signal<string[]>([]);
  private readonly preview = signal<CampaignFormValue | null>(null);

  /** True when players have joined — terms are API-locked. */
  protected termsLocked = false;

  /**
   * A completions value outside the offered 1/3/unlimited rows (possible via
   * the API) — surfaced as its own option so the select never renders blank
   * and a plain save never silently rewrites the value.
   */
  protected customCompletions: number | null = null;

  protected readonly goalTypeOptions = Object.keys(GOAL_TYPE_LABELS) as CampaignGoalType[];

  protected readonly goalTypeLabel = (v: CampaignGoalType): string =>
    GOAL_TYPE_LABELS[v] ?? String(v);

  protected get isEditMode(): boolean {
    return !!this.context.data?.campaign;
  }

  /**
   * THE live sentence — not a preview of copy the operator writes, but the
   * EXACT generated text players will read (docs/24 v2). Reads the mirrored
   * form value so it re-renders on every keystroke under OnPush, and degrades
   * to placeholders while the numbers are still blank.
   */
  protected readonly previewSentence = computed(() => {
    const v = this.preview();
    if (!v) return '';
    const goal =
      v.goalType === 'spend'
        ? tr('დახარჯე %s ₾').replace('%s', String(v.goalGel ?? '…'))
        : tr('ითამაშე %s-ჯერ').replace('%s', String(v.goalCount ?? '…'));
    const ids = this.selectedFacilityIds();
    const names = this.facilities()
      .filter((f) => ids.includes(f._id))
      .map((f) => f.name);
    // Georgian glues the venue names with a postposition, English needs a
    // preposition — so the clause is ONE translatable pattern with %s/%n
    // placeholders instead of a concatenation whose word order is fixed.
    const where =
      names.length === 0
        ? tr('ჩვენს მოედნებზე')
        : names.length <= 2
          ? tr('%s-ზე').replace('%s', () => names.join(' / '))
          : tr('%s და კიდევ %n მოედანზე')
              .replace('%s', () => names[0])
              .replace('%n', String(names.length - 1));
    // The deadline in the sentence IS the campaign end date (docs/24 v2).
    const until = v.endsAt ? ` ${tr('%s-მდე').replace('%s', this.fmtDate(v.endsAt))}` : '';
    const reward = tr('და მიიღე %s ₾ ვაუჩერი').replace('%s', String(v.rewardGel ?? '…'));
    const validity = v.rewardValidDays
      ? ` (${tr('ვადა %s დღე').replace('%s', String(v.rewardValidDays))})`
      : '';
    return `${goal} ${where}${until} ${reward}${validity}`;
  });

  ngOnInit(): void {
    const c = this.context.data?.campaign;
    this.termsLocked = !!c && c.enrolledCount > 0;

    const completions = c?.maxCompletionsPerUser;
    if (typeof completions === 'number' && completions !== 1 && completions !== 3) {
      this.customCompletions = completions;
    }

    this.form = this.fb.group({
      goalType: [
        { value: c?.goalType ?? 'bookings', disabled: this.termsLocked },
        [Validators.required],
      ],
      goalCount: [
        {
          value: c && c.goalType === 'bookings' ? c.goalTarget : 5,
          disabled: this.termsLocked,
        },
      ],
      goalGel: [
        {
          value: c && c.goalType === 'spend' ? tetriToGel(c.goalTarget) : 300,
          disabled: this.termsLocked,
        },
      ],
      rewardGel: [
        { value: c ? tetriToGel(c.rewardTetri) : 20, disabled: this.termsLocked },
        [Validators.required, Validators.min(1), Validators.max(5000)],
      ],
      rewardValidDays: [c?.rewardValidDays ?? null],
      // null = unlimited repeats; the template offers 1 / 3 / unlimited.
      maxCompletionsPerUser: [
        c?.maxCompletionsPerUser === undefined ? 1 : c.maxCompletionsPerUser,
      ],
      // Native date inputs bound to 'YYYY-MM-DD' strings ('' = no bound).
      // endsAt is THE shared player deadline — always editable.
      startsAt: [c?.startsAt ? c.startsAt.slice(0, 10) : ''],
      endsAt: [c?.endsAt ? c.endsAt.slice(0, 10) : ''],
      active: [c?.active ?? true],
      // Superadmin-only; '' = platform-wide. Scope is immutable after create.
      academyId: [{ value: c?.academy ?? '', disabled: this.isEditMode }],
    });

    this.goalType.set(c?.goalType ?? 'bookings');
    this.selectedFacilityIds.set(c?.facilities ? [...c.facilities] : []);
    this.applyGoalValidators(this.goalType());
    this.preview.set(this.form.getRawValue() as CampaignFormValue);

    // One subscription drives BOTH the conditional fields and the live
    // sentence — the whole form is the preview's input.
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const value = this.form.getRawValue() as CampaignFormValue;
        if (value.goalType !== this.goalType()) {
          this.goalType.set(value.goalType);
          this.applyGoalValidators(value.goalType);
        }
        this.preview.set(value);
      });

    if (this.isSuperAdmin()) {
      this.academyService
        .getAllAcademies()
        .pipe(take(1))
        .subscribe((academies) => this.academies.set(academies));
      // A superadmin's venue list follows the academy they pick.
      this.form
        .get('academyId')!
        .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((academyId: string) => {
          this.selectedFacilityIds.set([]);
          this.loadFacilities(academyId || null);
        });
      this.loadFacilities((c?.academy as string | undefined) ?? null);
    } else {
      this.tenant
        .ensure()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((academy) => this.loadFacilities(academy?._id ?? null));
    }
  }

  private loadFacilities(academyId: string | null): void {
    if (!academyId) {
      this.facilities.set([]);
      return;
    }
    this.facilityService
      .getFacilitiesByAcademy(academyId)
      .pipe(take(1))
      .subscribe({
        next: (facilities) =>
          this.facilities.set(
            facilities
              .filter((f) => !!f._id)
              .map((f) => ({ _id: f._id as string, name: f.name ?? '—' })),
          ),
        error: () => this.facilities.set([]),
      });
  }

  /** The target field swaps unit with the goal type, so do its validators. */
  private applyGoalValidators(type: CampaignGoalType): void {
    const count = this.form.get('goalCount')!;
    const gel = this.form.get('goalGel')!;
    if (type === 'bookings') {
      count.setValidators([Validators.required, Validators.min(1), Validators.max(200)]);
      gel.clearValidators();
    } else {
      gel.setValidators([Validators.required, Validators.min(1), Validators.max(50000)]);
      count.clearValidators();
    }
    count.updateValueAndValidity({ emitEvent: false });
    gel.updateValueAndValidity({ emitEvent: false });
  }

  /** 'YYYY-MM-DD' → 'DD.MM.YYYY' for the generated sentence. */
  private fmtDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
  }

  // ── scope multiselect ──────────────────────────────────────────────────────

  protected isFacilitySelected(id: string): boolean {
    return this.selectedFacilityIds().includes(id);
  }

  protected toggleFacility(id: string): void {
    this.selectedFacilityIds.update((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  /** "All venues" is the EMPTY selection — the server reads it that way too. */
  protected selectAllFacilities(): void {
    this.selectedFacilityIds.set([]);
  }

  // ── submit ─────────────────────────────────────────────────────────────────

  protected onSubmit(): void {
    if (this.form.invalid || this.isSaving()) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue() as CampaignFormValue;
    this.isSaving.set(true);
    const request = this.isEditMode
      ? this.campaignService.updateCampaign(
          this.context.data.campaign!._id,
          this.buildUpdateDto(v),
        )
      : this.campaignService.createCampaign(this.buildCreateDto(v));

    request.pipe(take(1)).subscribe({
      next: (saved) => this.context.completeWith(saved),
      error: (err: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.alerts
          .open(
            err.status === 409
              ? tr('პირობები დაბლოკილია — მონაწილეები უკვე შეუერთდნენ')
              : tr('შენახვა ვერ მოხერხდა, სცადეთ თავიდან'),
            { appearance: 'error' },
          )
          .pipe(take(1))
          .subscribe();
      },
    });
  }

  /** The goal in the unit the API expects: a count, or integer tetri. */
  private goalTarget(v: CampaignFormValue): number {
    return v.goalType === 'spend' ? gelToTetri(v.goalGel ?? 0) : (v.goalCount ?? 0);
  }

  /** CREATE: optional keys are included only when actually set. */
  private buildCreateDto(v: CampaignFormValue): CreateCampaignDto {
    const dto: CreateCampaignDto = {
      goalType: v.goalType,
      goalTarget: this.goalTarget(v),
      rewardTetri: gelToTetri(v.rewardGel!),
      maxCompletionsPerUser: v.maxCompletionsPerUser,
      active: v.active,
    };
    if (v.rewardValidDays != null) dto.rewardValidDays = v.rewardValidDays;
    if (this.selectedFacilityIds().length > 0) {
      dto.facilityIds = this.selectedFacilityIds();
    }
    if (v.startsAt) dto.startsAt = v.startsAt;
    if (v.endsAt) dto.endsAt = v.endsAt;
    if (this.isSuperAdmin() && v.academyId) dto.academyId = v.academyId;
    return dto;
  }

  /**
   * EDIT: cleared optional fields go over as explicit `null` so the API unsets
   * them. The terms are skipped entirely once players joined (locked
   * server-side; sending them would 409).
   */
  private buildUpdateDto(v: CampaignFormValue): UpdateCampaignDto {
    const dto: UpdateCampaignDto = {
      rewardValidDays: v.rewardValidDays ?? null,
      maxCompletionsPerUser: v.maxCompletionsPerUser,
      facilityIds: this.selectedFacilityIds(),
      startsAt: v.startsAt || null,
      endsAt: v.endsAt || null,
      active: v.active,
    };
    if (!this.termsLocked) {
      dto.goalType = v.goalType;
      dto.goalTarget = this.goalTarget(v);
      dto.rewardTetri = gelToTetri(v.rewardGel!);
    }
    return dto;
  }

  protected cancel(): void {
    this.context.completeWith(null);
  }
}
