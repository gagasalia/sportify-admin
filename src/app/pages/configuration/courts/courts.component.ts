import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  signal,
  inject,
  } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs';
import { CourtService } from '../../../services/http-services/court.service';
import { FacilityService } from '../../../services/http-services/facility.service';
import { TenantService } from '../../../shared/services/tenant.service';
import { Court } from '../../../shared/models/court.model';
import { Facility } from '../../../shared/models/facility.model';
import { CourtFormComponent } from './court-form/court-form.component';
import { CourtCardComponent } from './court-card/court-card.component';
import { CommonModule } from '@angular/common';
import { tr } from '../../../shared/i18n/lang';
import { TPipe } from '../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../shared/ui/toast.service';
import { SsDialogService } from '../../../shared/ui/dialog.service';
/**
 * Courts page, Taiga-free in the template (ss-* kit): facility chip rail
 * (first selected by default) + court cards. The add/edit dialog still opens
 * through SsDialogService — dialog machinery is the last migration phase.
 */
@Component({
  selector: 'app-courts',
  standalone: true,
  imports: [CourtCardComponent, CommonModule, TPipe],
  templateUrl: './courts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourtsComponent implements OnInit {
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly courtService = inject(CourtService);
  private readonly facilityService = inject(FacilityService);
  private readonly tenant = inject(TenantService);
  private readonly destroyRef = inject(DestroyRef);

  courts = signal<Court[]>([]);
  facilities = signal<Facility[]>([]);
  selectedFacilityId = signal<string | null>(null);
  isLoadingCourts = signal<boolean>(false);
  isLoadingFacilities = signal<boolean>(false);

  /** Resolve a facility's id from either API (`_id`) or legacy (`id`) shape. */
  private facilityId(f: Facility): string | null {
    return f._id ?? f.id ?? null;
  }

  facilityLabel(f: Facility): string {
    // The facility's own name is DATA (never translated); only the fallback is UI
    // copy, translated at render time so a language flip re-renders the chip.
    return f.name || f.description || tr('უსახელო ობიექტი');
  }

  ngOnInit(): void {
    // Resolve the tenant first so a hard refresh / deep link onto /courts waits
    // for `/academy/my` before reading `academyId()` (which is otherwise null
    // until the login flow runs, leaving the page stuck on an empty state).
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
      const match = facilities.find((f) => this.facilityId(f) === fromQuery);
      const fId = match ? this.facilityId(match) : this.facilityId(facilities[0]);
      if (fromQuery !== fId) this.updateQueryParam(fId);
      this.selectedFacilityId.set(fId);
      if (fId) this.loadCourts(fId);
    });
  }

  onFacilityChipClick(facility: Facility): void {
    const fId = this.facilityId(facility);
    if (fId === this.selectedFacilityId()) return;
    this.selectedFacilityId.set(fId);
    this.updateQueryParam(fId);
    if (fId) {
      this.loadCourts(fId);
    } else {
      this.courts.set([]);
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

  private loadCourts(facilityId: string): void {
    this.isLoadingCourts.set(true);
    this.courtService
      .getCourts(facilityId)
      .pipe(take(1))
      .subscribe({
        next: (courts) => {
          this.courts.set(courts);
          this.isLoadingCourts.set(false);
        },
        error: (error) => {
          console.error('Error loading courts:', error);
          this.isLoadingCourts.set(false);
        },
      });
  }

  addCourt(): void {
    const facilityId = this.selectedFacilityId();
    if (!facilityId) return;

    this.dialogs
      .open(CourtFormComponent, {
        label: tr('კორტის დამატება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: {
          facilityId,
          style: {
            height: '80vh',
            'max-height': '800px',
            overflow: 'hidden',
          },
        },
      })
      .pipe(take(1))
      .subscribe(() => {
        this.loadCourts(facilityId);
      });
  }

  onCourtUpdated(updatedCourt: Court): void {
    const currentCourts = this.courts();
    const updatedId = updatedCourt._id ?? updatedCourt.id;
    const index = currentCourts.findIndex((c) => (c._id ?? c.id) === updatedId);
    if (index !== -1) {
      const updatedCourts = [...currentCourts];
      updatedCourts[index] = updatedCourt;
      this.courts.set(updatedCourts);
    }
  }

  onEditCourt(court: Court): void {
    const facilityId = court.facility ?? court.facilityId ?? this.selectedFacilityId();
    this.dialogs
      .open(CourtFormComponent, {
        label: tr('რედაქტირება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: {
          court,
          facilityId,
          style: {
            height: '80vh',
            'max-height': '600px',
            overflow: 'hidden',
          },
        },
      })
      .pipe(take(1))
      .subscribe(() => {
        if (facilityId) this.loadCourts(facilityId);
      });
  }

  onDeleteCourt(court: Court): void {
    const facilityId = court.facility ?? court.facilityId ?? this.selectedFacilityId();
    const courtId = court._id ?? court.id;
    if (!facilityId || !courtId) return;

    this.courtService
      .deleteCourt(facilityId, courtId)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.loadCourts(facilityId);
          this.alerts
            .open(tr('კორტი წარმატებით წაიშალა'), { appearance: 'success' })
            .subscribe();
        },
        error: (error) => {
          console.error('Error deleting court:', error);
          this.alerts.open(tr('წაშლის დროს მოხდა შეცდომა'), { appearance: 'error' }).subscribe();
        },
      });
  }

  navigateToFacilities(): void {
    this.router.navigate(['/configuration/facilities']);
  }

  get selectedFacility(): Facility | undefined {
    const facilityId = this.selectedFacilityId();
    return facilityId
      ? this.facilities().find((f) => this.facilityId(f) === facilityId)
      : undefined;
  }
}
