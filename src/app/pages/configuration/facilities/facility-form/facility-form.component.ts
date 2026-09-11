import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormArray } from '@angular/forms';
import { take } from 'rxjs';
import { FacilityService } from '../../../../services/http-services/facility.service';
import {
  MediaService,
  MediaUnconfiguredError,
  MediaFileTooLargeError,
} from '../../../../services/http-services/media.service';
import { Facility, IMedia, CreateFacilityDto } from '../../../../shared/models/facility.model';
import { Amenity, AMENITY_LABELS, AMENITY_ICONS } from '../../../../shared/enums/amenity.enum';
import { CITY_OPTIONS } from '../../../../shared/enums/city.enum';
import { DISTRICT_OPTIONS } from '../../../../shared/enums/district.enum';
import { TenantService } from '../../../../shared/services/tenant.service';
import { tr } from '../../../../shared/i18n/lang';
import { TPipe } from '../../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../../shared/ui/toast.service';
import { SS_DIALOG_CONTEXT, SsDialogContext, SsDialogService } from '../../../../shared/ui/dialog.service';
interface CountryItem {
  readonly id: string;
  readonly name: string;
}

/**
 * Facility create/edit form — Taiga-free template (ss-* kit, native selects,
 * ss-checkbox amenities, ss-ic mask icons). Renders inside the SsDialogService
 * shell (SS_DIALOG_CONTEXT); coordinates are entered manually (lat/lng inputs).
 */
@Component({
  selector: 'app-facility-form',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, TPipe],
  templateUrl: './facility-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FacilityFormComponent implements OnInit {
  facilityForm!: FormGroup;

  protected readonly mediaItems = signal<IMedia[]>([]);

  // RAW Georgian labels — the template translates them at render time (`| t`);
  // the `id` is the value sent to the API and never translated.
  readonly countries: readonly CountryItem[] = [{ id: 'Georgia', name: 'საქართველო' }];
  readonly cities = CITY_OPTIONS;
  readonly districts = DISTRICT_OPTIONS;

  readonly amenities = Object.values(Amenity);
  readonly amenityLabels = AMENITY_LABELS;
  readonly amenityIcons = AMENITY_ICONS;

  /** assets/taiga-ui/icons URL for a '@lucide.xxx' / '@tui.xxx' icon name. */
  amenityIconUrl(amenity: Amenity): string {
    const name = (this.amenityIcons[amenity] ?? '').replace(/^@[a-z]+\./, '');
    return `url('assets/taiga-ui/icons/${name}.svg')`;
  }

  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    Facility | null,
    { facility?: Facility }
  >;

  private readonly tenant = inject(TenantService);
  private readonly mediaService = inject(MediaService);

  protected readonly isUploadingMedia = signal<boolean>(false);

  private readonly fb = inject(FormBuilder);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly facilityService = inject(FacilityService);
  private readonly alerts = inject(SsToastService);

  ngOnInit(): void {
    const f = this.context.data?.facility;

    this.facilityForm = this.fb.group({
      name: [f?.name || '', Validators.required],
      nameEn: [f?.nameEn || ''],
      description: [f?.description || ''],
      descriptionEn: [f?.descriptionEn || ''],
      country: [{ value: 'Georgia', disabled: true }],
      city: [f?.city || 'Tbilisi'],
      district: [f?.district || ''],
      amenities: this.createAmenitiesFormArray(f?.amenities as Amenity[] | undefined),
      contactInfo: this.fb.group({
        email: [f?.contactInfo?.email || ''],
        phone: [f?.contactInfo?.phone || ''],
        address: this.fb.group({
          street: [f?.contactInfo?.address?.street || f?.addressText || ''],
          lat: [
            f?.contactInfo?.address?.lat ||
              (f?.addressPin?.lat != null ? String(f.addressPin.lat) : ''),
          ],
          lng: [
            f?.contactInfo?.address?.lng ||
              (f?.addressPin?.lng != null ? String(f.addressPin.lng) : ''),
          ],
          city: [f?.contactInfo?.address?.city || ''],
        }),
        website: [f?.contactInfo?.website || ''],
        facebook: [f?.contactInfo?.facebook || ''],
        instagram: [f?.contactInfo?.instagram || ''],
      }),
    });

    // Pre-populate media from the API `media` field (stored publicUrl shape).
    if (f?.media?.length) {
      this.mediaItems.set(f.media);
    }
  }

  createAmenitiesFormArray(selectedAmenities?: Amenity[]): FormArray {
    return this.fb.array(
      this.amenities.map((amenity) =>
        this.fb.control(selectedAmenities?.includes(amenity) || false),
      ),
    );
  }

  get amenitiesFormArray(): FormArray {
    return this.facilityForm.get('amenities') as FormArray;
  }

  getSelectedAmenities(): string[] {
    return this.amenitiesFormArray.value
      .map((selected: boolean, index: number) => (selected ? this.amenities[index] : null))
      .filter((a: string | null) => a !== null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFiles(Array.from(input.files));
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
      this.handleFiles(Array.from(event.dataTransfer.files));
    }
  }

  private handleFiles(files: File[]): void {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    this.isUploadingMedia.set(true);
    let pending = imageFiles.length;
    const settle = () => {
      pending -= 1;
      if (pending === 0) {
        this.isUploadingMedia.set(false);
        this.cdr.markForCheck();
      }
    };

    imageFiles.forEach((file) => {
      this.mediaService
        .uploadImage(file, 'facility-media')
        .pipe(take(1))
        .subscribe({
          next: (media: IMedia) => {
            this.mediaItems.update((current) => [...current, media]);
            this.cdr.markForCheck();
            settle();
          },
          error: (error) => {
            if (error instanceof MediaUnconfiguredError) {
              this.alerts
                .open(tr('სურათების ატვირთვა ამ გარემოში არ არის კონფიგურირებული'), {
                  appearance: 'error',
                })
                .pipe(take(1))
                .subscribe();
            } else if (error instanceof MediaFileTooLargeError) {
              this.alerts
                .open(tr('ფაილი ძალიან დიდია. მაქსიმალური ზომაა 10 MB.'), { appearance: 'error' })
                .pipe(take(1))
                .subscribe();
            } else {
              console.error('Error uploading media:', error);
              this.alerts
                .open(tr('შეცდომა სურათის ატვირთვისას'), { appearance: 'error' })
                .pipe(take(1))
                .subscribe();
            }
            settle();
          },
        });
    });
  }

  removeMedia(index: number): void {
    this.mediaItems.update((current) => current.filter((_, i) => i !== index));
    this.cdr.markForCheck();
  }

  onSubmit(): void {
    if (this.facilityForm.invalid) {
      this.facilityForm.markAllAsTouched();
      this.alerts
        .open(tr('გთხოვთ შეავსოთ ყველა სავალდებულო ველი'), { appearance: 'error' })
        .pipe(take(1))
        .subscribe();
      return;
    }

    const owner = this.tenant.academyId();
    // The owner (academy id) is mandatory: a facility with an empty owner would
    // be orphaned. Block the submit and surface a Georgian error instead.
    if (!owner) {
      this.alerts
        .open(tr('აკადემია ვერ მოიძებნა'), { appearance: 'error' })
        .pipe(take(1))
        .subscribe();
      return;
    }

    const editingFacility = this.context.data?.facility;
    const v = this.facilityForm.getRawValue();

    const dto: CreateFacilityDto = {
      owner,
      name: v.name,
      nameEn: v.nameEn || undefined,
      description: v.description || '',
      descriptionEn: v.descriptionEn || undefined,
      amenities: this.getSelectedAmenities(),
      country: v.country,
      city: v.city,
      district: v.district || undefined,
      media: this.mediaItems(),
      contactInfo: {
        email: v.contactInfo.email || undefined,
        phone: v.contactInfo.phone || undefined,
        address: {
          street: v.contactInfo.address.street || undefined,
          lat: v.contactInfo.address.lat || undefined,
          lng: v.contactInfo.address.lng || undefined,
          city: v.contactInfo.address.city || undefined,
        },
        website: v.contactInfo.website || undefined,
        facebook: v.contactInfo.facebook || undefined,
        instagram: v.contactInfo.instagram || undefined,
      },
    };

    const facilityId = editingFacility?._id || editingFacility?.id;
    const saveOperation = facilityId
      ? this.facilityService.updateFacility(facilityId, dto)
      : this.facilityService.createFacility(dto);

    saveOperation.pipe(take(1)).subscribe({
      next: (savedFacility) => {
        const message = tr(
          facilityId ? 'ობიექტი წარმატებით განახლდა!' : 'ობიექტი წარმატებით დაემატა!',
        );
        this.alerts.open(message, { appearance: 'success' }).pipe(take(1)).subscribe();
        this.context.completeWith(savedFacility);
      },
      error: () => {
        const message = tr(
          facilityId ? 'შეცდომა ობიექტის განახლებისას.' : 'შეცდომა ობიექტის დამატებისას.',
        );
        this.alerts.open(message, { appearance: 'error' }).pipe(take(1)).subscribe();
      },
    });
  }

  onCancel(): void {
    this.context.completeWith(null);
  }
}
