import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { TPipe } from '../../shared/i18n/t.pipe';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../shared/ui/dialog.service';
import {
  CustomerProfile,
  UpdateCustomerContactDto,
} from '../../shared/models/customer.model';
import { phoneFormatValidator } from '../../shared/validators/phone-format.validator';

/** Payload for {@link ContactDialogComponent}. */
export interface ContactDialogData {
  profile: CustomerProfile;
  /** Email edits are superadmin-only (the API enforces it too). */
  allowEmail: boolean;
}

/**
 * "Manual account fix" dialog: operator-side correction of a player's contact
 * details. Emits ONLY the fields that actually changed (the API treats absent
 * fields as untouched); cancel emits null.
 */
@Component({
  selector: 'app-contact-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="flex flex-col gap-4" [formGroup]="form" (ngSubmit)="submit()">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="ss-field">
          <span class="ss-label georgian-text" lang="ka">{{ 'სახელი' | t }}</span>
          <input class="ss-input" type="text" formControlName="firstName" />
        </label>
        <label class="ss-field">
          <span class="ss-label georgian-text" lang="ka">{{ 'გვარი' | t }}</span>
          <input class="ss-input" type="text" formControlName="lastName" />
        </label>
      </div>
      <label class="ss-field">
        <span class="ss-label georgian-text" lang="ka">{{ 'ტელეფონი' | t }}</span>
        <input
          class="ss-input"
          type="tel"
          inputmode="tel"
          placeholder="5XX XX XX XX"
          formControlName="phone"
        />
        @if (form.get('phone')?.touched && form.get('phone')?.hasError('phoneFormat')) {
          <span class="ss-error georgian-text" lang="ka">
            {{ 'ჩაწერეთ 9-ნიშნა ნომერი (ან +995…), უცხოური ნომრისთვის — ქვეყნის კოდი (+…)' | t }}
          </span>
        }
      </label>
      @if (data.allowEmail) {
        <label class="ss-field">
          <span class="ss-label">{{ 'ელ. ფოსტა' | t }}</span>
          <input class="ss-input" type="email" formControlName="email" />
          @if (form.get('email')?.touched && form.get('email')?.invalid) {
            <span class="ss-error georgian-text" lang="ka">
              {{ 'ელ. ფოსტის ფორმატი არასწორია' | t }}
            </span>
          }
        </label>
      }
      <div class="flex justify-end gap-3">
        <button class="ss-btn ss-btn--outline" type="button" (click)="context.completeWith(null)">
          <span class="georgian-text" lang="ka">{{ 'გაუქმება' | t }}</span>
        </button>
        <button
          automation-id="contact-save"
          class="ss-btn ss-btn--primary"
          type="submit"
          [disabled]="form.invalid"
        >
          <span class="georgian-text" lang="ka">{{ 'შენახვა' | t }}</span>
        </button>
      </div>
    </form>
  `,
})
export class ContactDialogComponent {
  protected readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    UpdateCustomerContactDto | null,
    ContactDialogData
  >;
  private readonly fb = inject(FormBuilder);

  protected readonly data: ContactDialogData = this.context.data ?? {
    profile: {} as CustomerProfile,
    allowEmail: false,
  };

  protected readonly form = this.fb.group({
    firstName: [this.data.profile.firstName ?? ''],
    lastName: [this.data.profile.lastName ?? ''],
    phone: [this.data.profile.phone ?? '', [phoneFormatValidator]],
    email: [
      this.data.profile.email ?? '',
      [Validators.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)],
    ],
  });

  protected submit(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const dto: UpdateCustomerContactDto = {};
    const p = this.data.profile;
    if ((v.firstName ?? '').trim() && v.firstName!.trim() !== (p.firstName ?? '')) {
      dto.firstName = v.firstName!.trim();
    }
    if ((v.lastName ?? '').trim() && v.lastName!.trim() !== (p.lastName ?? '')) {
      dto.lastName = v.lastName!.trim();
    }
    if ((v.phone ?? '').trim() && v.phone!.trim() !== (p.phone ?? '')) {
      dto.phone = v.phone!.trim();
    }
    if (
      this.data.allowEmail &&
      (v.email ?? '').trim() &&
      v.email!.trim() !== p.email
    ) {
      dto.email = v.email!.trim();
    }
    // Nothing changed → same as cancel, no PATCH fired.
    if (Object.keys(dto).length === 0) {
      this.context.completeWith(null);
      return;
    }
    this.context.completeWith(dto);
  }
}
