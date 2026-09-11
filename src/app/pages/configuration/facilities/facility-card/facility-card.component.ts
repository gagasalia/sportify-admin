import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  signal,
  ChangeDetectionStrategy,
  OnChanges,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Facility } from '../../../../shared/models/facility.model';
import { AMENITY_LABELS, AMENITY_ICONS } from '../../../../shared/enums/amenity.enum';
import { cityName as cityDisplayName } from '../../../../shared/enums/city.enum';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { defaultIfEmpty, take } from 'rxjs';
import { FacilityService } from '../../../../services/http-services/facility.service';
import { tr } from '../../../../shared/i18n/lang';
import { localizedName, localizedText } from '../../../../shared/i18n/localized';
import { TPipe } from '../../../../shared/i18n/t.pipe';

import { SsDialogService } from '../../../../shared/ui/dialog.service';
import { SsToastService } from '../../../../shared/ui/toast.service';
import { SsConfirmComponent, SsConfirmData } from '../../../../shared/ui/confirm.component';
@Component({
  selector: 'app-facility-card',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TPipe],
  templateUrl: './facility-card.component.html',
  styleUrls: ['./facility-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FacilityCardComponent implements OnChanges {
  @Input({ required: true }) facility!: Facility;
  @Output() facilityUpdated = new EventEmitter<Facility>();
  @Output() editFacility = new EventEmitter<Facility>();
  @Output() deleteFacility = new EventEmitter<Facility>();

  readonly amenityLabels = AMENITY_LABELS;
  readonly amenityIcons = AMENITY_ICONS;

  // Local mirror of the publish state so the optimistic toggle never mutates the @Input.
  readonly activeState = signal(false);

  ngOnChanges(): void {
    this.activeState.set(this.facility.activeState ?? false);
  }

  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
  private readonly facilityService = inject(FacilityService);

  get primaryPhoto(): string {
    if (this.facility.media?.length) return this.facility.media[0].url;
    if (this.facility.photos?.length) return this.facility.photos[0];
    return 'images/facility-placeholder.png';
  }

  get hasMultiplePhotos(): boolean {
    const count = this.facility.media?.length ?? this.facility.photos?.length ?? 0;
    return count > 1;
  }

  get photoCount(): number {
    return this.facility.media?.length ?? this.facility.photos?.length ?? 0;
  }

  // Single-country MVP — the country stays hard-coded; the city comes from the
  // facility (თბილისი / წყნეთი). Both stay RAW Georgian here — the template
  // translates them at render time (`| t`).
  get cityName(): string {
    return cityDisplayName(this.facility.city);
  }
  readonly countryName = 'საქართველო';

  /**
   * Operator CONTENT, not dictionary copy: an English session shows `nameEn` /
   * `descriptionEn` when the operator filled them in, and the Georgian original
   * otherwise. Read in the template so a language flip re-renders the card.
   */
  protected displayName(): string {
    return localizedName(this.facility);
  }

  protected displayDescription(): string {
    return localizedText(this.facility.description, this.facility.descriptionEn) ?? '';
  }

  /**
   * `tr()` on a confirm message plus the `{name}` fill-in: the name is DATA, so
   * the placeholder keeps it wherever the translated sentence puts it.
   */
  private withName(message: string): string {
    return tr(message).replace('{name}', () => this.displayName());
  }

  onToggleState(checked: boolean): void {
    const facilityId = this.facility._id ?? this.facility.id;
    if (!facilityId) {
      return;
    }

    // The switch reflects the requested state while the confirm is open; it
    // snaps back unless the operator confirms (dismissal counts as "no").
    this.activeState.set(checked);

    const data: SsConfirmData = checked
      ? {
          content: this.withName('გამოვაქვეყნოთ „{name}"? ის ხილული გახდება მოთამაშეებისთვის.'),
          yes: tr('გამოქვეყნება'),
          no: tr('გაუქმება'),
        }
      : {
          content: this.withName('მოვხსნათ „{name}" გამოქვეყნებიდან? მოთამაშეები მას ვეღარ ნახავენ.'),
          yes: tr('მოხსნა'),
          no: tr('გაუქმება'),
          appearance: 'destructive',
        };

    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr(checked ? 'ობიექტის გამოქვეყნება' : 'გამოქვეყნების მოხსნა'),
        size: 's',
        data,
      })
      .pipe(take(1), defaultIfEmpty(false))
      .subscribe((confirmed) => {
        if (!confirmed) {
          this.activeState.set(!checked);
          return;
        }
        this.patchState(facilityId, checked);
      });
  }

  /** Optimistic PATCH; reverts the mirror if the request fails. */
  private patchState(facilityId: string, checked: boolean): void {
    this.facilityService
      .setFacilityStatus(facilityId, checked)
      .pipe(take(1))
      .subscribe({
        next: (updated) => {
          this.activeState.set(updated.activeState ?? checked);
          this.facilityUpdated.emit(updated);
        },
        error: (error) => {
          console.error('Error updating facility state:', error);
          this.activeState.set(!checked);
        },
      });
  }

  onEdit(event: Event): void {
    event.stopPropagation();
    this.editFacility.emit(this.facility);
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('ობიექტის წაშლა'),
        size: 's',
        data: {
          content: this.withName('ნამდვილად წავშალოთ „{name}"?'),
          yes: tr('წაშლა'),
          no: tr('გაუქმება'),
          appearance: 'destructive',
        },
      })
      .pipe(take(1))
      .subscribe((response) => {
        if (response) {
          this.deleteFacility.emit(this.facility);
        }
      });
  }

  openInGoogleMaps(event: Event): void {
    event.stopPropagation();

    // Prefer API address coordinates, fall back to legacy addressPin
    const addrLat = this.facility.contactInfo?.address?.lat;
    const addrLng = this.facility.contactInfo?.address?.lng;
    const pin = this.facility.addressPin;

    const lat = addrLat != null ? Number(addrLat) : pin?.lat != null ? Number(pin.lat) : NaN;
    const lng = addrLng != null ? Number(addrLng) : pin?.lng != null ? Number(pin.lng) : NaN;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      this.alerts
        .open(tr('ობიექტის მისამართი დამატებული არაა'), { appearance: 'error' })
        .pipe(take(1))
        .subscribe();
      return;
    }

    // Construct Google Maps URL using the @lat,lng,zoomz pattern
    const zoom = 17;
    const url = `https://www.google.com/maps/@${lat},${lng},${zoom}z`;

    window.open(url, '_blank');
  }

  onManageCourts(event: Event): void {
    event.stopPropagation();
    // TODO: Implement courts management functionality
  }
}
