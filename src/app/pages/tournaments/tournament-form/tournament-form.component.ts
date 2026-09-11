import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { take } from 'rxjs';
import { TournamentService } from '../../../services/http-services/tournament.service';
import { FacilityService } from '../../../services/http-services/facility.service';
import { TenantService } from '../../../shared/services/tenant.service';
import {
  CreateTournamentDto,
  Tournament,
  TournamentCategory,
  TournamentFormat,
  TournamentLevel,
  TournamentType,
} from '../../../shared/models/tournament.model';
import { Facility } from '../../../shared/models/facility.model';
import { gelToTetri, tetriToGel } from '../../../shared/utils/money.util';

import { liveLabels, tr } from '../../../shared/i18n/lang';
import { TPipe } from '../../../shared/i18n/t.pipe';
import { SsToastService } from '../../../shared/ui/toast.service';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../../shared/ui/dialog.service';
export const TYPE_LABELS: Record<TournamentType, string> = liveLabels({
  singles: 'სინგლები',
  doubles: 'წყვილები',
});
export const FORMAT_LABELS: Record<TournamentFormat, string> = liveLabels({
  knockout: 'ნოკაუტი',
  round_robin: 'წრიული',
  groups_playoffs: 'ჯგუფები + პლეიოფი',
  championship: 'ჩემპიონატი',
  americano: 'ამერიკანო',
  mexicano: 'მექსიკანო',
});
export const LEVEL_LABELS: Record<TournamentLevel, string> = liveLabels({
  any: 'ნებისმიერი',
  beginner: 'დამწყები',
  intermediate: 'საშუალო',
  advanced: 'გამოცდილი',
});
export const CATEGORY_LABELS: Record<TournamentCategory, string> = liveLabels({
  men: 'კაცები',
  women: 'ქალები',
  mixed: 'შერეული',
});

/** ISO instant → value for `<input type="datetime-local">` (local wall clock). */
function isoToLocalInput(iso: string | undefined): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Create/edit tournament dialog (docs/13 §7). Fee is edited in GEL and
 * crosses the wire as integer tetri; the deadline is a local datetime input
 * converted to an ISO instant. The academy is derived server-side from the
 * chosen facility — nothing tenant-y is sent from the client.
 */
@Component({
  selector: 'app-tournament-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TPipe],
  templateUrl: './tournament-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TournamentFormComponent implements OnInit {
  form!: FormGroup;

  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    Tournament | null,
    { tournament?: Tournament }
  >;
  private readonly fb = inject(FormBuilder);
  private readonly tournamentService = inject(TournamentService);
  private readonly facilityService = inject(FacilityService);
  private readonly tenant = inject(TenantService);
  private readonly alerts = inject(SsToastService);

  protected readonly facilities = signal<Facility[]>([]);
  protected readonly isSaving = signal(false);
  /** Mirrors the `facility` control for the chip rail (OnPush-friendly). */
  protected readonly selectedFacilityId = signal<string>('');

  protected readonly typeOptions = Object.keys(TYPE_LABELS) as TournamentType[];
  protected readonly formatOptions = Object.keys(FORMAT_LABELS) as TournamentFormat[];
  protected readonly levelOptions = Object.keys(LEVEL_LABELS) as TournamentLevel[];
  protected readonly categoryOptions = Object.keys(CATEGORY_LABELS) as TournamentCategory[];

  protected readonly stringifyType = (v: TournamentType): string => TYPE_LABELS[v] ?? String(v);
  protected readonly stringifyFormat = (v: TournamentFormat): string =>
    FORMAT_LABELS[v] ?? String(v);
  protected readonly stringifyLevel = (v: TournamentLevel): string => LEVEL_LABELS[v] ?? String(v);
  protected readonly stringifyCategory = (v: TournamentCategory): string =>
    CATEGORY_LABELS[v] ?? String(v);

  protected get isEditMode(): boolean {
    return !!this.context.data?.tournament;
  }

  ngOnInit(): void {
    const t = this.context.data?.tournament;

    this.form = this.fb.group({
      name: [t?.name ?? '', [Validators.required, Validators.minLength(3)]],
      nameEn: [t?.nameEn ?? ''],
      facility: [t?.facility ?? '', [Validators.required]],
      type: [t?.type ?? 'doubles', [Validators.required]],
      format: [t?.format ?? 'knockout', [Validators.required]],
      level: [t?.level ?? 'any', [Validators.required]],
      category: [t?.category ?? 'mixed', [Validators.required]],
      startDate: [t?.startDate ?? '', [Validators.required]],
      startTime: [t?.startTime ?? '10:00', [Validators.required]],
      endDate: [t?.endDate ?? ''],
      registrationDeadline: [isoToLocalInput(t?.registrationDeadline)],
      entryFeeGel: [
        t ? tetriToGel(t.entryFeeTetri) : 0,
        [Validators.required, Validators.min(0), Validators.max(10_000)],
      ],
      maxParticipants: [
        t?.maxParticipants ?? 16,
        [Validators.required, Validators.min(2), Validators.max(512)],
      ],
      prizeDescription: [t?.prizeDescription ?? ''],
      prizeDescriptionEn: [t?.prizeDescriptionEn ?? ''],
      description: [t?.description ?? ''],
      descriptionEn: [t?.descriptionEn ?? ''],
    });

    this.selectedFacilityId.set(t?.facility ?? '');

    // The academy's facilities feed the host-venue chip rail; when creating,
    // the first facility is preselected so the required control starts valid.
    this.tenant
      .ensure()
      .pipe(take(1))
      .subscribe(() => {
        const academyId = this.tenant.academyId();
        if (!academyId) {
          return;
        }
        this.facilityService
          .getFacilitiesByAcademy(academyId)
          .pipe(take(1))
          .subscribe((facilities) => {
            this.facilities.set(facilities);
            if (!this.selectedFacilityId() && facilities.length > 0) {
              this.selectFacility(this.facilityId(facilities[0]));
            }
          });
      });
  }

  protected facilityId(facility: Facility): string {
    return facility._id ?? facility.id ?? '';
  }

  protected selectFacility(id: string): void {
    this.selectedFacilityId.set(id);
    this.form.get('facility')?.setValue(id);
    this.form.get('facility')?.markAsDirty();
  }

  protected onSubmit(): void {
    if (this.form.invalid || this.isSaving()) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue() as {
      name: string;
      nameEn: string;
      facility: string;
      type: TournamentType;
      format: TournamentFormat;
      level: TournamentLevel;
      category: TournamentCategory;
      startDate: string;
      startTime: string;
      endDate: string;
      registrationDeadline: string;
      entryFeeGel: number;
      maxParticipants: number;
      prizeDescription: string;
      prizeDescriptionEn: string;
      description: string;
      descriptionEn: string;
    };

    const dto: CreateTournamentDto = {
      facility: v.facility,
      name: v.name.trim(),
      nameEn: v.nameEn.trim() || undefined,
      type: v.type,
      format: v.format,
      level: v.level,
      category: v.category,
      startDate: v.startDate,
      startTime: v.startTime,
      endDate: v.endDate || undefined,
      registrationDeadline: v.registrationDeadline
        ? new Date(v.registrationDeadline).toISOString()
        : undefined,
      entryFeeTetri: gelToTetri(v.entryFeeGel),
      maxParticipants: v.maxParticipants,
      prizeDescription: v.prizeDescription.trim() || undefined,
      prizeDescriptionEn: v.prizeDescriptionEn.trim() || undefined,
      description: v.description.trim() || undefined,
      descriptionEn: v.descriptionEn.trim() || undefined,
    };

    this.isSaving.set(true);
    const request = this.isEditMode
      ? this.tournamentService.updateTournament(
          this.context.data.tournament!._id,
          dto,
        )
      : this.tournamentService.createTournament(dto);

    request.pipe(take(1)).subscribe({
      next: (tournament) => this.context.completeWith(tournament),
      error: (err: HttpErrorResponse) => {
        this.isSaving.set(false);
        const message =
          err.status === 400
            ? tr('შეამოწმე ველები — მოთხოვნა ვერ დამუშავდა')
            : tr('შენახვა ვერ მოხერხდა, სცადეთ თავიდან');
        this.alerts.open(message, { appearance: 'negative' }).pipe(take(1)).subscribe();
      },
    });
  }

  protected cancel(): void {
    this.context.completeWith(null);
  }
}
