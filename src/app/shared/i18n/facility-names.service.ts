import { Injectable, inject, signal } from '@angular/core';
import { take } from 'rxjs';
import { FacilityService } from '../../services/http-services/facility.service';
import { Facility } from '../models/facility.model';
import { TenantService } from '../services/tenant.service';
import { localizedName } from './localized';

/**
 * Facility-name lookup for rows that carry only a GEORGIAN display SNAPSHOT.
 *
 * Bookings, matches and campaigns freeze `facilityName` at creation, so an
 * English session has nothing to show there — the `nameEn` the operator typed
 * lives on the facility document. This service loads an academy's facilities
 * once and resolves those snapshots back to a live name by id; the snapshot
 * stays the fallback, which is what a deleted facility (or a row from another
 * academy) falls back to.
 *
 * `label()` reads a SIGNAL, so a page that renders it re-renders both when the
 * facilities arrive and when the language flips.
 */
@Injectable({ providedIn: 'root' })
export class FacilityNamesService {
  private readonly facilityService = inject(FacilityService);
  private readonly tenant = inject(TenantService);

  /** facility id → facility, across every academy loaded so far. */
  private readonly byId = signal<ReadonlyMap<string, Facility>>(new Map());

  /** Academies already fetched (or in flight), so each is loaded once. */
  private readonly loaded = new Set<string>();

  /** Load the facilities of the operator's own academy (superadmins: none). */
  ensure(): void {
    this.tenant
      .ensure()
      .pipe(take(1))
      .subscribe((academy) => {
        if (academy?._id) {
          this.ensureFor(academy._id);
        }
      });
  }

  ensureFor(academyId: string): void {
    if (!academyId || this.loaded.has(academyId)) {
      return;
    }
    this.loaded.add(academyId);
    this.facilityService
      .getFacilitiesByAcademy(academyId)
      .pipe(take(1))
      .subscribe({
        next: (facilities) => {
          const next = new Map(this.byId());
          for (const facility of facilities) {
            const id = facility._id ?? facility.id;
            if (id) {
              next.set(id, facility);
            }
          }
          this.byId.set(next);
        },
        // A failed lookup is not worth an error state: every caller passes the
        // Georgian snapshot as the fallback, so the row still reads correctly.
        error: () => this.loaded.delete(academyId),
      });
  }

  /** The localized name for `facilityId`, or the row's own snapshot. */
  label(facilityId: string | undefined | null, fallback: string | undefined | null): string {
    const facility = facilityId ? this.byId().get(facilityId) : undefined;
    return (facility && localizedName(facility)) || fallback || '';
  }
}
