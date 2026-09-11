import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { Court } from '../../../../shared/models/court.model';
import {
  SportType,
  CourtLocationType,
  SPORT_TYPE_LABELS,
  SPORT_TYPE_ICONS,
  COURT_LOCATION_TYPE_LABELS,
  SURFACE_MATERIAL_LABELS,
  SURFACE_COLOR_LABELS,
} from '../../../../shared/enums/court-type.enum';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { defaultIfEmpty, take } from 'rxjs';
import { CourtService } from '../../../../services/http-services/court.service';

import { SsDialogService } from '../../../../shared/ui/dialog.service';
import { SsToastService } from '../../../../shared/ui/toast.service';
import { SsConfirmComponent, SsConfirmData } from '../../../../shared/ui/confirm.component';
import { tr } from '../../../../shared/i18n/lang';
import { TPipe } from '../../../../shared/i18n/t.pipe';
@Component({
  selector: 'app-court-card',
  standalone: true,
  imports: [CommonModule, FormsModule, TPipe],
  templateUrl: './court-card.component.html',
  styleUrls: ['./court-card.component.scss'],
})
export class CourtCardComponent {
  @Input({ required: true }) court!: Court;
  @Output() courtUpdated = new EventEmitter<Court>();
  @Output() editCourt = new EventEmitter<Court>();
  @Output() deleteCourt = new EventEmitter<Court>();

  readonly sportTypeLabels = SPORT_TYPE_LABELS;
  readonly sportTypeIcons = SPORT_TYPE_ICONS;
  readonly locationTypeLabels = COURT_LOCATION_TYPE_LABELS;
  readonly surfaceMaterialLabels = SURFACE_MATERIAL_LABELS;
  readonly surfaceColorLabels = SURFACE_COLOR_LABELS;

  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
  private readonly courtService = inject(CourtService);

  /** Location type from API (`locationType`) or legacy (`type`). */
  private get location(): CourtLocationType | undefined {
    return this.court.locationType ?? this.court.type;
  }

  /** Surface from API (`surface`) or legacy (`courtSurface`). */
  private get surface() {
    return this.court.surface ?? this.court.courtSurface;
  }

  get sportTypeName(): string {
    return this.sportTypeLabels[this.court.sportType as SportType] || '';
  }

  get sportTypeIcon(): string {
    return this.sportTypeIcons[this.court.sportType as SportType] || '@lucide.square';
  }

  get locationTypeName(): string {
    const loc = this.location;
    return loc ? this.locationTypeLabels[loc] || '' : '';
  }

  get locationTypeIcon(): string {
    const iconMap: Record<CourtLocationType, string> = {
      [CourtLocationType.Indoor]: '@lucide.home',
      [CourtLocationType.Outdoor]: '@lucide.sun',
      [CourtLocationType.Covered]: '@lucide.umbrella',
    };
    const loc = this.location;
    return (loc && iconMap[loc]) || '@lucide.building';
  }

  get surfaceMaterialName(): string {
    const material = this.surface?.material;
    return material ? this.surfaceMaterialLabels[material] || '' : '';
  }

  get surfaceColorName(): string {
    const color = this.surface?.color;
    return color ? this.surfaceColorLabels[color] || '' : '';
  }

  get isPublished(): boolean {
    return this.court.activeState;
  }

  /** Display label — the Georgian court name (matches the card title). */
  private get courtLabel(): string {
    return this.court.name;
  }

  onToggleState(checked: boolean): void {
    const facilityId = this.court.facility ?? this.court.facilityId;
    const courtId = this.court._id ?? this.court.id;
    if (!facilityId || !courtId) {
      return;
    }

    // The switch reflects the requested state while the confirm is open; it
    // snaps back unless the operator confirms (dismissal counts as "no").
    this.court.activeState = checked;

    // The confirm renders `content` verbatim, so it is translated HERE (at the
    // call site, right before display); the court's own name stays untouched.
    const data: SsConfirmData = checked
      ? {
          content: `${tr('გამოვაქვეყნოთ')} „${this.courtLabel}"? ${tr('მოთამაშეები შეძლებენ მის დაჯავშნას.')}`,
          yes: tr('გამოქვეყნება'),
          no: tr('გაუქმება'),
        }
      : {
          content: `${tr('მოვხსნათ გამოქვეყნებიდან')} „${this.courtLabel}"? ${tr('მისი დაჯავშნა ვეღარ მოხერხდება.')}`,
          yes: tr('მოხსნა'),
          no: tr('გაუქმება'),
          appearance: 'destructive',
        };

    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: checked ? tr('კორტის გამოქვეყნება') : tr('გამოქვეყნების მოხსნა'),
        size: 's',
        data,
      })
      .pipe(take(1), defaultIfEmpty(false))
      .subscribe((confirmed) => {
        if (!confirmed) {
          this.court.activeState = !checked;
          return;
        }
        this.patchState(facilityId, courtId, checked);
      });
  }

  /** Optimistic PATCH; reverts the card state if the request fails. */
  private patchState(facilityId: string, courtId: string, checked: boolean): void {
    this.courtService
      .setCourtStatus(facilityId, courtId, checked)
      .pipe(take(1))
      .subscribe({
        next: (updated) => {
          this.courtUpdated.emit(updated);
        },
        error: (error) => {
          console.error('Error updating court state:', error);
          this.court.activeState = !checked;
        },
      });
  }

  onEdit(event: Event): void {
    event.stopPropagation();
    this.editCourt.emit(this.court);
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('კორტის წაშლა'),
        size: 's',
        data: {
          content: `${tr('ნამდვილად წავშალოთ')} „${this.courtLabel}"?`,
          yes: tr('წაშლა'),
          no: tr('გაუქმება'),
          appearance: 'destructive',
        },
      })
      .pipe(take(1))
      .subscribe((response) => {
        if (response) {
          this.deleteCourt.emit(this.court);
        }
      });
  }
}
