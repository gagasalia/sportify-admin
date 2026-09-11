import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  signal,
  inject,
  } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs';
import { FacilityService } from '../../../services/http-services/facility.service';
import { TenantService } from '../../../shared/services/tenant.service';
import { Facility } from '../../../shared/models/facility.model';
import { FacilityFormComponent } from './facility-form/facility-form.component';
import { FacilityCardComponent } from './facility-card/facility-card.component';
import { tr } from '../../../shared/i18n/lang';
import { TPipe } from '../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../shared/ui/toast.service';
import { SsDialogService } from '../../../shared/ui/dialog.service';
@Component({
  selector: 'app-facilities',
  standalone: true,
  imports: [FacilityCardComponent, TPipe],
  templateUrl: './facilities.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FacilitiesComponent implements OnInit {
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
  private readonly facilityService = inject(FacilityService);
  private readonly tenant = inject(TenantService);
  private readonly destroyRef = inject(DestroyRef);

  facilities = signal<Facility[]>([]);
  isLoading = signal<boolean>(false);

  private facilityId(f: Facility): string | undefined {
    return f._id ?? f.id;
  }

  ngOnInit(): void {
    // Drive the initial load through the tenant resolution so a hard refresh /
    // deep link (where the login flow never resolved the tenant) still waits for
    // `/academy/my` before reading `academyId()` — instead of reading a
    // still-null signal and rendering an empty state forever.
    this.tenant
      .ensure()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadFacilities());
  }

  addFacility(): void {
    this.dialogs
      .open(FacilityFormComponent, {
        label: tr('ობიექტის დამატება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: {
          style: {
            height: '80vh',
            'max-height': '600px',
            overflow: 'hidden',
          },
        },
      })
      .pipe(take(1))
      .subscribe(() => {
        this.loadFacilities();
      });
  }

  onFacilityUpdated(updatedFacility: Facility): void {
    const updatedId = this.facilityId(updatedFacility);
    const currentFacilities = this.facilities();
    const index = currentFacilities.findIndex((f) => this.facilityId(f) === updatedId);
    if (index !== -1) {
      const updatedFacilities = [...currentFacilities];
      updatedFacilities[index] = updatedFacility;
      this.facilities.set(updatedFacilities);
    }
  }

  onEditFacility(facility: Facility): void {
    this.dialogs
      .open(FacilityFormComponent, {
        label: tr('რედაქტირება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: {
          facility,
          style: {
            height: '80vh',
            'max-height': '600px',
            overflow: 'hidden',
          },
        },
      })
      .pipe(take(1))
      .subscribe(() => {
        this.loadFacilities();
      });
  }

  private loadFacilities(): void {
    const academyId = this.tenant.academyId();
    if (!academyId) {
      this.facilities.set([]);
      return;
    }

    this.isLoading.set(true);
    this.facilityService
      .getFacilitiesByAcademy(academyId)
      .pipe(take(1))
      .subscribe({
        next: (facilities) => {
          this.facilities.set(facilities);
          this.isLoading.set(false);
        },
        error: (error) => {
          console.error('Error loading facilities:', error);
          this.isLoading.set(false);
        },
      });
  }

  onDeleteFacility(facility: Facility): void {
    const facilityId = this.facilityId(facility);
    if (!facilityId) return;
    this.facilityService
      .deleteFacility(facilityId)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.facilities.update((list) => list.filter((f) => this.facilityId(f) !== facilityId));
          this.alerts.open(tr('ობიექტი წარმატებით წაიშალა'), { appearance: 'success' }).subscribe();
        },
        error: (error) => {
          console.error('Error deleting facility:', error);
          this.alerts.open(tr('წაშლის დროს მოხდა შეცდომა'), { appearance: 'error' }).subscribe();
        },
      });
  }
}
