import {
  Component,
  OnInit,
  signal,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { AcademyService } from '../../../services/http-services/academy.service';
import {
  MediaService,
  MediaUnconfiguredError,
  MediaFileTooLargeError,
} from '../../../services/http-services/media.service';
import {
  Academy,
  IMedia,
  SportRule,
  UpdateAcademyDto,
} from '../../../shared/models/academy.model';
import { TenantService } from '../../../shared/services/tenant.service';
import { SportType } from '../../../shared/enums/court-type.enum';
import { gelToTetri, tetriToGel } from '../../../shared/utils/money.util';
import { tr } from '../../../shared/i18n/lang';
import { TPipe } from '../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../shared/ui/toast.service';
/** A padel game needs 4 rackets (docs/20) — the academy decides how many are included. */
const PADEL_MAX_RACKETS = 4;

/** Academy configuration — Taiga-free template (ss-* kit; alerts stay for toasts). */
@Component({
  selector: 'app-academy',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, TPipe],
  templateUrl: './academy.component.html',
  styleUrls: ['./academy.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcademyComponent implements OnInit {
  academyForm!: FormGroup;
  academy = signal<Academy | null>(null);
  isLoading = signal<boolean>(false);
  isSaving = signal<boolean>(false);
  isSaved = signal<boolean>(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly tenant = inject(TenantService);
  private readonly mediaService = inject(MediaService);
  private readonly fb = inject(FormBuilder);
  private readonly academyService = inject(AcademyService);
  private readonly alerts = inject(SsToastService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  isUploadingLogo = signal<boolean>(false);

  ngOnInit(): void {
    this.initializeForm();
    this.loadAcademy();

    this.academyForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.academyForm.dirty) {
          this.isSaved.set(false);
        }
      });
  }

  readonly padelMaxRackets = PADEL_MAX_RACKETS;

  /**
   * Range hint for `racketsIncluded`, composed at READ time: `{max}` is filled
   * after the lookup so the number keeps following the (differently ordered)
   * translated sentence instead of a baked-in Georgian one.
   */
  get racketsRangeError(): string {
    return tr('მიუთითეთ რიცხვი 0-დან {max}-მდე').replace('{max}', String(PADEL_MAX_RACKETS));
  }

  private initializeForm(): void {
    this.academyForm = this.fb.group({
      name: ['', Validators.required],
      descriptionGeorgian: [''],
      descriptionEnglish: [''],
      logo: this.fb.group({
        url: [''],
        type: [''],
        size: [0],
        thumbUrl: [''],
        key: [''],
        thumbKey: [''],
        metadata: [null],
      }),
      // Padel equipment rule (docs/20): counts + GEL prices; empty price =
      // that offer doesn't exist (rent/sale not available).
      padelRules: this.fb.group({
        racketsIncluded: [
          0,
          [
            Validators.required,
            Validators.min(0),
            Validators.max(PADEL_MAX_RACKETS),
          ],
        ],
        racketRentGel: [null as number | null, [Validators.min(0)]],
        ballsPriceGel: [null as number | null, [Validators.min(0)]],
      }),
    });
  }

  private get academyId(): string | null {
    return this.tenant.academyId();
  }

  private loadAcademy(): void {
    this.isLoading.set(true);
    // Initialize through ensure() so a hard refresh / deep link onto /academy
    // resolves the tenant (one `/academy/my` call, replayed if already resolved)
    // before patching the form, instead of reading a still-null signal.
    this.tenant
      .ensure()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (academy) => {
          if (academy) {
            this.academy.set(academy);
            this.academyForm.patchValue(academy);
            this.patchPadelRules(academy);
            this.isSaved.set(true);
          }
          this.isLoading.set(false);
          this.cdr.markForCheck();
        },
        error: (error) => {
          console.error('Error loading academy:', error);
          this.isLoading.set(false);
          this.cdr.markForCheck();
          this.alerts
            .open(tr('შეცდომა აკადემიის ჩატვირთვისას'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  onSave(): void {
    if (this.academyForm.valid) {
      const academyId = this.academyId;
      // Never dispatch an update with an empty id: without a resolved tenant the
      // request would target the wrong (or no) academy. Block and surface a
      // Georgian error instead.
      if (!academyId) {
        this.alerts
          .open(tr('აკადემია ვერ მოიძებნა'), { appearance: 'error' })
          .pipe(take(1))
          .subscribe();
        return;
      }

      this.isSaving.set(true);
      const payload = this.buildUpdatePayload();

      this.academyService
        .updateAcademy(academyId, payload)
        .pipe(take(1))
        .subscribe({
          next: (savedAcademy) => {
            this.academy.set(savedAcademy);
            this.isSaving.set(false);
            this.isSaved.set(true);
            this.academyForm.markAsPristine();
            this.cdr.markForCheck();
            this.alerts
              .open(tr('აკადემია წარმატებით შეინახა!'), { appearance: 'success' })
              .pipe(take(1))
              .subscribe();
          },
          error: (error) => {
            console.error('Error saving academy:', error);
            this.isSaving.set(false);
            this.cdr.markForCheck();
            this.alerts
              .open(tr('შეცდომა აკადემიის შენახვისას'), { appearance: 'error' })
              .pipe(take(1))
              .subscribe();
          },
        });
    } else {
      this.academyForm.markAllAsTouched();
      this.alerts
        .open(tr('გთხოვთ შეავსოთ ყველა სავალდებულო ველი'), { appearance: 'error' })
        .pipe(take(1))
        .subscribe();
    }
  }

  /**
   * Builds the `PUT /academy/:id` payload from the form, OMITTING empty optional
   * fields rather than sending empty strings/placeholders that fail backend
   * validation:
   *  - empty-string optional fields (descriptions) are dropped;
   *  - the logo group is dropped entirely unless a real logo exists (non-empty
   *    url) — the placeholder `{url:'',type:''}` would otherwise fail nested
   *    media validation.
   * `name` (required) is always sent.
   */
  private buildUpdatePayload(): UpdateAcademyDto {
    const v = this.academyForm.value;

    const payload: UpdateAcademyDto = { name: v.name };

    const optionalText: (keyof UpdateAcademyDto)[] = [
      'descriptionGeorgian',
      'descriptionEnglish',
    ];
    for (const key of optionalText) {
      const value = v[key];
      // Omit empty strings (and null/undefined); keep only real, non-blank values.
      if (typeof value === 'string' && value.trim() !== '') {
        (payload[key] as string) = value;
      }
    }

    // Only attach the logo when a real one was uploaded (non-empty url). The
    // initial/cleared placeholder `{url:'', type:''}` must never be sent, and
    // the optional rendition fields are omitted rather than sent as ''.
    // REMOVAL is explicit: the academy had a logo and the form no longer does
    // → send `logo: null` so the API clears it and releases the S3 objects
    // (omitting the field entirely would silently keep the old logo).
    const logo = v.logo as IMedia | undefined;
    if (logo?.url) {
      payload.logo = {
        url: logo.url,
        type: logo.type,
        size: logo.size,
        ...(logo.thumbUrl ? { thumbUrl: logo.thumbUrl } : {}),
        ...(logo.key ? { key: logo.key } : {}),
        ...(logo.thumbKey ? { thumbKey: logo.thumbKey } : {}),
      };
    } else if (this.academy()?.logo?.url) {
      payload.logo = null;
    }

    const padelRule = this.buildPadelRule();
    if (padelRule) {
      payload.sportRules = [padelRule];
    }

    return payload;
  }

  /** The stored padel rule, if the academy has one. */
  private get existingPadelRule(): SportRule | undefined {
    return this.academy()?.sportRules?.find((r) => r.sportType === SportType.Padel);
  }

  /** Patches the padel-rule section from the loaded academy (tetri → GEL). */
  private patchPadelRules(academy: Academy): void {
    const rule = academy.sportRules?.find((r) => r.sportType === SportType.Padel);
    if (!rule) {
      return; // keep the pristine defaults (0 included, nothing offered)
    }
    this.academyForm.get('padelRules')?.patchValue({
      racketsIncluded: rule.racketsIncluded,
      racketRentGel: rule.racketRentTetri != null ? tetriToGel(rule.racketRentTetri) : null,
      ballsPriceGel: rule.ballsPriceTetri != null ? tetriToGel(rule.ballsPriceTetri) : null,
    });
  }

  /**
   * The padel rule for the PUT payload (GEL → tetri), or undefined to OMIT the
   * `sportRules` field: an academy that never had a rule and left the section
   * untouched must not get an empty rule manufactured by an unrelated save
   * (docs/20 §2). An empty price input means "not offered" — the key is dropped.
   */
  private buildPadelRule(): SportRule | undefined {
    const v = this.academyForm.value.padelRules as {
      racketsIncluded: number | null;
      racketRentGel: number | null;
      ballsPriceGel: number | null;
    };
    const racketsIncluded = v.racketsIncluded ?? 0;
    const touched =
      racketsIncluded > 0 || v.racketRentGel != null || v.ballsPriceGel != null;
    if (!this.existingPadelRule && !touched) {
      return undefined;
    }
    const rule: SportRule = { sportType: SportType.Padel, racketsIncluded };
    if (v.racketRentGel != null) {
      rule.racketRentTetri = gelToTetri(v.racketRentGel);
    }
    if (v.ballsPriceGel != null) {
      rule.ballsPriceTetri = gelToTetri(v.ballsPriceGel);
    }
    return rule;
  }

  navigateToFacilities(): void {
    this.router.navigate(['/configuration/facilities']);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      this.handleFile(event.dataTransfer.files[0]);
    }
  }

  private handleFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      this.alerts
        .open(tr('გთხოვთ აირჩიოთ სურათის ფაილი'), { appearance: 'error' })
        .pipe(take(1))
        .subscribe();
      return;
    }

    this.isUploadingLogo.set(true);
    this.mediaService
      .uploadImage(file, 'academy-logo')
      .pipe(take(1))
      .subscribe({
        next: (media) => {
          this.academyForm.patchValue({
            logo: {
              url: media.url,
              type: media.type,
              size: media.size,
              thumbUrl: media.thumbUrl ?? '',
              key: media.key ?? '',
              thumbKey: media.thumbKey ?? '',
              metadata: null,
            },
          });
          this.academyForm.markAsDirty();
          this.isUploadingLogo.set(false);
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.isUploadingLogo.set(false);
          this.cdr.markForCheck();
          if (error instanceof MediaUnconfiguredError) {
            this.alerts
              .open(tr('სურათების ატვირთვა ამ გარემოში არ არის კონფიგურირებული'), {
                appearance: 'error',
              })
              .pipe(take(1))
              .subscribe();
            return;
          }
          if (error instanceof MediaFileTooLargeError) {
            this.alerts
              .open(tr('ფაილი ძალიან დიდია. მაქსიმალური ზომაა 10 MB.'), { appearance: 'error' })
              .pipe(take(1))
              .subscribe();
            return;
          }
          console.error('Error uploading logo:', error);
          this.alerts
            .open(tr('შეცდომა სურათის ატვირთვისას'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  removeLogo(): void {
    this.academyForm.patchValue({
      logo: { url: '', type: '', size: 0, thumbUrl: '', key: '', thumbKey: '', metadata: null },
    });
    this.academyForm.markAsDirty();
    this.cdr.markForCheck();
  }

  get logoUrl(): string {
    return this.academyForm.get('logo.url')?.value || '';
  }
}
