import {
  Component,
  DestroyRef,
  OnInit,
  signal,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  FormsModule,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs';
import { ScheduleService } from '../../../services/http-services/schedule.service';
import { FacilityService } from '../../../services/http-services/facility.service';
import { TenantService } from '../../../shared/services/tenant.service';
import {
  FacilityScheduleDTO,
  HolidayDTO,
  PricingDTO,
  TimeRangeDTO,
  WeeklyHoursDTO,
  Weekday,
} from '../../../shared/models/schedule.model';
import { Facility } from '../../../shared/models/facility.model';
import { Day, DAY_LABELS } from '../../../shared/enums/day.enum';
import { tr } from '../../../shared/i18n/lang';
import { TPipe } from '../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../shared/ui/toast.service';
/** Validates that a group's `endHour:endMinute` is strictly after `startHour:startMinute`. */
function endAfterStartValidator(
  startHourKey = 'startHour',
  startMinuteKey = 'startMinute',
  endHourKey = 'endHour',
  endMinuteKey = 'endMinute',
): (group: AbstractControl) => ValidationErrors | null {
  return (group: AbstractControl): ValidationErrors | null => {
    const sh = group.get(startHourKey)?.value;
    const sm = group.get(startMinuteKey)?.value;
    const eh = group.get(endHourKey)?.value;
    const em = group.get(endMinuteKey)?.value;
    if (sh == null || sm == null || eh == null || em == null) return null;
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    return end > start ? null : { endNotAfterStart: true };
  };
}

/**
 * Working hours, holidays and pricing — Taiga-free template (ss-* kit). Hour/
 * minute pickers are native selects with [ngValue] (number-typed values);
 * holidays use a native date input + removable badge chips instead of the old
 * TuiInputDateMulti calendar. SsToastService remains for toasts.
 */
@Component({
  selector: 'app-working-hours-and-prices',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, FormsModule, TPipe],
  templateUrl: './working-hours-and-prices.component.html',
  styleUrls: ['./working-hours-and-prices.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkingHoursAndPricesComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly scheduleService = inject(ScheduleService);
  private readonly facilityService = inject(FacilityService);
  private readonly tenant = inject(TenantService);
  private readonly alerts = inject(SsToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  scheduleForm!: FormGroup;
  pricesForm!: FormGroup;
  schedule = signal<FacilityScheduleDTO | null>(null);
  facilities = signal<Facility[]>([]);
  selectedFacilityId = signal<string | null>(null);
  isLoading = signal<boolean>(false);
  isLoadingFacilities = signal<boolean>(false);

  private facilityIdOf(f: Facility): string | null {
    return f._id ?? f.id ?? null;
  }

  facilityLabel(f: Facility): string {
    // The facility's own name is DATA (never translated); only the fallback is UI
    // copy, translated at render time so a language flip re-renders the chip.
    return f.name || f.description || tr('უსახელო ობიექტი');
  }

  // Picked holiday dates as sorted 'YYYY-MM-DD' strings; the server holiday
  // docs are kept alongside so removals can be addressed by `_id`.
  holidays: string[] = [];
  /** ngModel of the native add-a-holiday date input. */
  holidayInput = '';
  private serverHolidays: HolidayDTO[] = [];

  // Working days selection — derived from / written into weeklyHours
  // (a day is "working" iff it has at least one time range).
  workingDays: Partial<Record<Day, boolean>> = {
    [Day.Monday]: true,
    [Day.Tuesday]: true,
    [Day.Wednesday]: true,
    [Day.Thursday]: true,
    [Day.Friday]: true,
    [Day.Saturday]: true,
    [Day.Sunday]: false,
  };

  /** Adds the native date input's value to the picked-holidays set. */
  addHoliday(): void {
    const iso = this.holidayInput;
    if (!iso || this.holidays.includes(iso)) return;
    this.holidays = [...this.holidays, iso].sort();
    this.holidayInput = '';
  }

  removeHoliday(iso: string): void {
    this.holidays = this.holidays.filter((d) => d !== iso);
  }

  // Group days: Weekdays (Mon-Fri), Saturday, Sunday. Labels stay RAW Georgian —
  // the template renders them through `| t` (never bake a translation in).
  readonly dayGroups = [
    {
      key: 'weekdays',
      label: 'კვირის დღეები',
      days: [Day.Monday, Day.Tuesday, Day.Wednesday, Day.Thursday, Day.Friday],
    },
    { key: 'saturday', label: 'შაბათი', days: [Day.Saturday] },
    { key: 'sunday', label: 'კვირა', days: [Day.Sunday] },
  ];

  readonly days = [
    Day.Monday,
    Day.Tuesday,
    Day.Wednesday,
    Day.Thursday,
    Day.Friday,
    Day.Saturday,
    Day.Sunday,
  ];
  readonly dayLabels = DAY_LABELS;

  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly minutes = [0, 30];

  readonly stringifyHour = (hour: number): string => hour.toString().padStart(2, '0');
  readonly stringifyMinute = (minute: number): string => minute.toString().padStart(2, '0');

  ngOnInit(): void {
    this.initializePricesForm();
    // Resolve the tenant first so a hard refresh / deep link onto /working-hours
    // waits for `/academy/my` before reading `academyId()`.
    this.tenant
      .ensure()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadFacilities());
  }

  private loadFacilities(): void {
    const academyId = this.tenant.academyId();
    if (!academyId) {
      this.facilities.set([]);
      this.selectedFacilityId.set(null);
      return;
    }

    this.isLoadingFacilities.set(true);
    this.facilityService
      .getFacilitiesByAcademy(academyId)
      .pipe(take(1))
      .subscribe({
        next: (facilities) => {
          this.facilities.set(facilities);
          this.isLoadingFacilities.set(false);
          this.resolveSelection(facilities);
        },
        error: (error) => {
          console.error('Error loading facilities:', error);
          this.isLoadingFacilities.set(false);
        },
      });
  }

  /** The first chip is selected by default; a valid ?facilityId= overrides it. */
  private resolveSelection(facilities: Facility[]): void {
    this.route.queryParams.pipe(take(1)).subscribe((params) => {
      if (facilities.length === 0) {
        this.selectedFacilityId.set(null);
        return;
      }
      const fromQuery = params['facilityId'];
      const match = facilities.find((f) => this.facilityIdOf(f) === fromQuery);
      const fId = match ? this.facilityIdOf(match) : this.facilityIdOf(facilities[0]);
      if (fromQuery !== fId) this.updateQueryParam(fId);
      this.selectedFacilityId.set(fId);
      if (fId) this.loadScheduleForFacility(fId);
    });
  }

  onFacilityChipClick(facility: Facility): void {
    const fId = this.facilityIdOf(facility);
    if (fId === this.selectedFacilityId()) return;
    this.selectedFacilityId.set(fId);
    this.updateQueryParam(fId);
    if (fId) {
      this.loadScheduleForFacility(fId);
    } else {
      this.schedule.set(null);
      this.scheduleForm = null!;
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

  navigateToFacilities(): void {
    this.router.navigate(['/configuration/facilities']);
  }

  /** Loads the whole schedule resource for the selected facility (single source). */
  private loadScheduleForFacility(facilityId: string): void {
    this.isLoading.set(true);
    this.scheduleService
      .getSchedule(facilityId)
      .pipe(take(1))
      .subscribe({
        next: (schedule) => {
          this.schedule.set(schedule);
          this.applySchedule(schedule);
          this.isLoading.set(false);
        },
        error: (error) => {
          console.error('Error loading schedule:', error);
          this.isLoading.set(false);
          this.alerts
            .open(tr('შეცდომა გრაფიკის ჩატვირთვისას'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  /** Hydrates all three forms (hours/working-days, holidays, prices) from one doc. */
  private applySchedule(schedule: FacilityScheduleDTO): void {
    this.initializeForm(schedule);
    this.applyHolidays(schedule);
    this.applyPrices(schedule);
  }

  private rangeFor(weeklyHours: WeeklyHoursDTO, day: Weekday): TimeRangeDTO {
    return weeklyHours?.[day]?.[0] ?? { start: '09:00', end: '22:00' };
  }

  private initializeForm(schedule: FacilityScheduleDTO): void {
    const wh = schedule.weeklyHours;

    // Derive "working day" from whether the day has any ranges.
    this.workingDays = {
      [Day.Monday]: (wh?.[Day.Monday as Weekday]?.length ?? 0) > 0,
      [Day.Tuesday]: (wh?.[Day.Tuesday as Weekday]?.length ?? 0) > 0,
      [Day.Wednesday]: (wh?.[Day.Wednesday as Weekday]?.length ?? 0) > 0,
      [Day.Thursday]: (wh?.[Day.Thursday as Weekday]?.length ?? 0) > 0,
      [Day.Friday]: (wh?.[Day.Friday as Weekday]?.length ?? 0) > 0,
      [Day.Saturday]: (wh?.[Day.Saturday as Weekday]?.length ?? 0) > 0,
      [Day.Sunday]: (wh?.[Day.Sunday as Weekday]?.length ?? 0) > 0,
    };

    const buildGroup = (range: TimeRangeDTO): FormGroup => {
      const [sh, sm] = range.start.split(':').map(Number);
      const [eh, em] = range.end.split(':').map(Number);
      return this.fb.group(
        {
          startHour: [sh, Validators.required],
          startMinute: [sm, Validators.required],
          endHour: [eh, Validators.required],
          endMinute: [em, Validators.required],
        },
        { validators: endAfterStartValidator() },
      );
    };

    // Mon–Fri are collapsed into a single "weekdays" range, seeded from Monday's
    // range (per-day weekday editing is a future enhancement). Any per-day
    // backend differences across Mon–Fri are intentionally NOT round-tripped by
    // this form — onSave writes Monday's range to all five weekdays.
    this.scheduleForm = this.fb.group({
      weekdays: buildGroup(this.rangeFor(wh, Day.Monday as Weekday)),
      saturday: buildGroup(this.rangeFor(wh, Day.Saturday as Weekday)),
      sunday: buildGroup(this.rangeFor(wh, Day.Sunday as Weekday)),
    });
  }

  private applyHolidays(schedule: FacilityScheduleDTO): void {
    this.serverHolidays = schedule.holidays ?? [];
    this.holidays = this.serverHolidays.map((h) => h.date).sort();
  }

  private initializePricesForm(): void {
    this.pricesForm = this.fb.group({
      generalPrice: [0, [Validators.required, Validators.min(0)]],
      offPeakStartHour: [0, Validators.required],
      offPeakStartMinute: [0, Validators.required],
      offPeakEndHour: [0, Validators.required],
      offPeakEndMinute: [0, Validators.required],
      offPeakPrice: [0, [Validators.required, Validators.min(0)]],
    });
  }

  private applyPrices(schedule: FacilityScheduleDTO): void {
    const pricing = schedule.pricing;
    if (!pricing) {
      this.pricesForm.reset({
        generalPrice: 0,
        offPeakStartHour: 0,
        offPeakStartMinute: 0,
        offPeakEndHour: 0,
        offPeakEndMinute: 0,
        offPeakPrice: 0,
      });
      return;
    }

    const [opSh, opSm] = (pricing.offPeak?.start ?? '00:00').split(':').map(Number);
    const [opEh, opEm] = (pricing.offPeak?.end ?? '00:00').split(':').map(Number);

    this.pricesForm.patchValue({
      generalPrice: ScheduleService.tetriToGel(pricing.generalPriceTetri),
      offPeakStartHour: opSh,
      offPeakStartMinute: opSm,
      offPeakEndHour: opEh,
      offPeakEndMinute: opEm,
      offPeakPrice: ScheduleService.tetriToGel(pricing.offPeak?.priceTetri ?? 0),
    });
  }

  toggleWorkingDay(day: Day): void {
    this.workingDays[day] = !this.workingDays[day];
  }

  private hhmm(hour: number, minute: number): string {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }

  private rangeFromGroup(group: { startHour: number; startMinute: number; endHour: number; endMinute: number }): TimeRangeDTO {
    return {
      start: this.hhmm(group.startHour, group.startMinute),
      end: this.hhmm(group.endHour, group.endMinute),
    };
  }

  /** Saves weekly hours per selected facility. Disabled days get no ranges. */
  onSave(): void {
    const facilityId = this.selectedFacilityId();
    if (!facilityId || !this.scheduleForm?.valid) {
      this.scheduleForm?.markAllAsTouched();
      return;
    }

    const v = this.scheduleForm.value;
    const weekdayRange = this.rangeFromGroup(v.weekdays);
    const saturdayRange = this.rangeFromGroup(v.saturday);
    const sundayRange = this.rangeFromGroup(v.sunday);

    const dayRange = (day: Day): TimeRangeDTO[] => {
      if (!this.workingDays[day]) return [];
      if (day === Day.Saturday) return [saturdayRange];
      if (day === Day.Sunday) return [sundayRange];
      return [weekdayRange];
    };

    const weeklyHours: WeeklyHoursDTO = {
      [Day.Monday]: dayRange(Day.Monday),
      [Day.Tuesday]: dayRange(Day.Tuesday),
      [Day.Wednesday]: dayRange(Day.Wednesday),
      [Day.Thursday]: dayRange(Day.Thursday),
      [Day.Friday]: dayRange(Day.Friday),
      [Day.Saturday]: dayRange(Day.Saturday),
      [Day.Sunday]: dayRange(Day.Sunday),
    };

    this.isLoading.set(true);
    this.scheduleService
      .updateWeeklyHours(facilityId, weeklyHours)
      .pipe(take(1))
      .subscribe({
        next: (updated) => {
          this.schedule.set(updated);
          this.isLoading.set(false);
          this.alerts
            .open(tr('გრაფიკი წარმატებით შეინახა!'), { appearance: 'success' })
            .pipe(take(1))
            .subscribe();
        },
        error: (error) => {
          console.error('Error saving schedule:', error);
          this.isLoading.set(false);
          this.alerts
            .open(tr('შეცდომა გრაფიკის შენახვისას'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  onSaveWorkingDays(): void {
    // Working days are now part of weeklyHours; saving hours persists them.
    this.onSave();
  }

  /**
   * Reconciles the picked holiday dates against the server's holiday subdocs:
   * deletes removed ones by `_id`, adds new ones. The schedule resource is the
   * source of truth (no localStorage).
   */
  onSaveHolidays(): void {
    const facilityId = this.selectedFacilityId();
    if (!facilityId) return;

    const pickedIso = new Set(this.holidays);
    const existingIso = new Set(this.serverHolidays.map((h) => h.date));

    // A server holiday the user un-picked should be deleted — but we can only
    // address subdocs by `_id`. If one lacks an `_id` we cannot delete it, so the
    // page state would silently diverge from the server. Warn per-doc and raise a
    // single alert so the user knows the divergence happened.
    const removed = this.serverHolidays.filter((h) => !pickedIso.has(h.date));
    const undeletable = removed.filter((h) => !h._id);
    undeletable.forEach((h) => console.warn('Holiday missing _id, cannot delete', h));
    if (undeletable.length > 0) {
      this.alerts
        .open(
          tr('ზოგიერთი დასვენების დღის წაშლა ვერ მოხერხდა — გვერდი შესაძლოა არ ემთხვეოდეს სერვერს.'),
          { appearance: 'warning' },
        )
        .pipe(take(1))
        .subscribe();
    }

    const toDelete = removed.filter((h) => h._id);
    const toAddIso = [...pickedIso].filter((iso) => !existingIso.has(iso));

    const ops = [
      ...toDelete.map((h) => this.scheduleService.deleteHoliday(facilityId, h._id!)),
      ...toAddIso.map((iso) =>
        this.scheduleService.addHoliday(facilityId, { date: iso, isClosed: true }),
      ),
    ];

    if (ops.length === 0) {
      this.alerts
        .open(tr('დასვენების დღეები წარმატებით შეინახა!'), { appearance: 'success' })
        .pipe(take(1))
        .subscribe();
      return;
    }

    // Run sequentially; the last response carries the up-to-date holiday list.
    this.runHolidayOps(ops, facilityId);
  }

  private runHolidayOps(
    ops: ReturnType<ScheduleService['addHoliday']>[],
    facilityId: string,
  ): void {
    const [first, ...rest] = ops;
    first.pipe(take(1)).subscribe({
      next: (schedule) => {
        if (rest.length > 0) {
          this.runHolidayOps(rest, facilityId);
        } else {
          this.schedule.set(schedule);
          this.applyHolidays(schedule);
          this.alerts
            .open(tr('დასვენების დღეები წარმატებით შეინახა!'), { appearance: 'success' })
            .pipe(take(1))
            .subscribe();
        }
      },
      error: (error) => {
        console.error('Error saving holidays:', error);
        this.alerts
          .open(tr('შეცდომა დასვენების დღეების შენახვისას'), { appearance: 'error' })
          .pipe(take(1))
          .subscribe();
      },
    });
  }

  /** Off-peak window must end strictly after it starts. */
  private offPeakValid(v: {
    offPeakStartHour: number;
    offPeakStartMinute: number;
    offPeakEndHour: number;
    offPeakEndMinute: number;
  }): boolean {
    const start = v.offPeakStartHour * 60 + v.offPeakStartMinute;
    const end = v.offPeakEndHour * 60 + v.offPeakEndMinute;
    return end > start;
  }

  onSavePrices(): void {
    const facilityId = this.selectedFacilityId();
    if (!facilityId || !this.pricesForm.valid) {
      this.pricesForm.markAllAsTouched();
      return;
    }

    const v = this.pricesForm.value;

    const hasOffPeak = this.offPeakValid(v);
    // Reject an inverted off-peak window only when one was actually entered
    // (a zeroed/equal window means "no off-peak").
    if (!hasOffPeak && (v.offPeakPrice > 0 || v.offPeakEndHour > 0 || v.offPeakEndMinute > 0)) {
      this.alerts
        .open(tr('არაპიკური ფანჯრის დასასრული უნდა იყოს დაწყების შემდეგ'), { appearance: 'error' })
        .pipe(take(1))
        .subscribe();
      return;
    }

    const pricing: PricingDTO = {
      currency: 'GEL',
      generalPriceTetri: ScheduleService.gelToTetri(v.generalPrice),
      ...(hasOffPeak
        ? {
            offPeak: {
              start: this.hhmm(v.offPeakStartHour, v.offPeakStartMinute),
              end: this.hhmm(v.offPeakEndHour, v.offPeakEndMinute),
              priceTetri: ScheduleService.gelToTetri(v.offPeakPrice),
            },
          }
        : {}),
    };

    this.isLoading.set(true);
    this.scheduleService
      .updatePricing(facilityId, pricing)
      .pipe(take(1))
      .subscribe({
        next: (updated) => {
          this.schedule.set(updated);
          this.isLoading.set(false);
          this.alerts
            .open(tr('ფასები წარმატებით შეინახა!'), { appearance: 'success' })
            .pipe(take(1))
            .subscribe();
        },
        error: (error) => {
          console.error('Error saving prices:', error);
          this.isLoading.set(false);
          this.alerts
            .open(tr('შეცდომა ფასების შენახვისას'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }
}
