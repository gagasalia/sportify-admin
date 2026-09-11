import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { take } from 'rxjs';
import { type MaskitoOptions } from '@maskito/core';
import { MaskitoDirective } from '@maskito/angular';
import {
  maskitoPrefixPostprocessorGenerator,
  maskitoAddOnFocusPlugin,
  maskitoRemoveOnBlurPlugin,
} from '@maskito/kit';
import { UserManagementService } from '../../../../services/http-services/user-management.service';
import { CreateUserDto, User, UserType } from '../../../../shared/models/user.model';
import { arrayRequiredValidator } from '../../../../shared/validators/array-required.validator';
import { liveLabels, tr } from '../../../../shared/i18n/lang';
import { TPipe } from '../../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../../shared/ui/toast.service';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../../../shared/ui/dialog.service';
@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, MaskitoDirective, TPipe],
  templateUrl: './user-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserFormComponent implements OnInit {
  userForm!: FormGroup;

  readonly userTypes = Object.values(UserType);

  /** RAW-Georgian role labels; `liveLabels` translates on every read (never baked). */
  readonly userTypeLabels: Record<UserType, string> = liveLabels({
    [UserType.ADMIN]: 'ადმინი',
    [UserType.USER]: 'მომხმარებელი',
    [UserType.SUPERADMIN]: 'სუპერადმინი',
  });

  readonly phoneMask: MaskitoOptions = {
    mask: ['+', '9', '9', '5', /[5]/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/],
    postprocessors: [maskitoPrefixPostprocessorGenerator('+995')],
    plugins: [maskitoAddOnFocusPlugin('+995'), maskitoRemoveOnBlurPlugin('+995')],
  };

  readonly pidMask: MaskitoOptions = {
    mask: [/\d/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/],
  };

  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    User | null,
    { user?: User }
  >;
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserManagementService);
  private readonly alerts = inject(SsToastService);

  protected get isEditMode(): boolean {
    return !!this.context.data?.user;
  }

  ngOnInit(): void {
    const editingUser = this.context.data?.user;

    // Native-date 'YYYY-MM-DD' string ('' = unset), local wall-clock.
    let dateOfBirth = '';
    if (editingUser?.dateOfBirth) {
      const d = new Date(editingUser.dateOfBirth);
      if (!isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        dateOfBirth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
    }

    const phoneValue = this.formatPhoneForDisplay(editingUser?.phone || '');

    this.userForm = this.fb.group({
      email: [editingUser?.email || '', [Validators.required, Validators.email]],
      password: ['', editingUser ? [] : [Validators.required, Validators.minLength(6)]],
      firstName: [editingUser?.firstName || ''],
      lastName: [editingUser?.lastName || ''],
      phone: [phoneValue],
      username: [editingUser?.username || ''],
      pid: [editingUser?.pid || '', [Validators.pattern(/^\d{11}$/)]],
      dateOfBirth: [dateOfBirth],
      userType: [editingUser?.userType?.length ? [...editingUser.userType] : [UserType.USER], [arrayRequiredValidator]],
    });
    this.applyIdentityValidators();
  }

  /**
   * Player/admin identity split (mirrors the API rule): admin accounts sign in
   * by USERNAME and carry no phone; player accounts sign in by PHONE and carry
   * no username. Only the active identity field is validated (and submitted).
   */
  protected get isAdminAccount(): boolean {
    const roles: UserType[] = this.userForm?.get('userType')?.value ?? [];
    return roles.includes(UserType.ADMIN) || roles.includes(UserType.SUPERADMIN);
  }

  private applyIdentityValidators(): void {
    const phone = this.userForm.get('phone');
    const username = this.userForm.get('username');
    if (this.isAdminAccount) {
      phone?.clearValidators();
      username?.setValidators([
        Validators.required,
        Validators.pattern(/^[a-zA-Z0-9._-]{3,32}$/),
      ]);
    } else {
      username?.clearValidators();
      phone?.setValidators([
        Validators.required,
        Validators.pattern(/^\+9955\d{8}$/),
      ]);
    }
    phone?.updateValueAndValidity({ emitEvent: false });
    username?.updateValueAndValidity({ emitEvent: false });
  }

  private formatPhoneForDisplay(phone: string): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('995') && digits.length >= 4) {
      return '+995' + digits.slice(3);
    }
    if (digits.startsWith('5') && digits.length >= 1) {
      return '+995' + digits;
    }
    return '';
  }

  private extractPhoneDigits(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  onSubmit(): void {
    if (this.userForm.invalid) return;

    const formValue = this.userForm.value;
    const editingUser = this.context.data?.user;
    // 'YYYY-MM-DD' → local-midnight instant (same semantics as the old TuiDay
    // toLocalNativeDate path); '' stays undefined.
    let dateOfBirth: string | undefined;
    if (formValue.dateOfBirth) {
      const [y, m, d] = String(formValue.dateOfBirth).split('-').map(Number);
      dateOfBirth = new Date(y, m - 1, d).toISOString();
    }
    // Only the identity field the account kind uses is sent — the API rejects
    // a phone on admin accounts and a username on player accounts, and $unsets
    // the leftover field itself when a role changes.
    const identity = this.isAdminAccount
      ? { username: String(formValue.username).trim().toLowerCase() }
      : { phone: this.extractPhoneDigits(formValue.phone) };

    if (editingUser?._id) {
      const updateDto = {
        email: formValue.email,
        firstName: formValue.firstName || undefined,
        lastName: formValue.lastName || undefined,
        ...identity,
        pid: formValue.pid || undefined,
        dateOfBirth,
        userType: formValue.userType,
        ...(formValue.password ? { password: formValue.password } : {}),
      };

      this.userService
        .updateUser(editingUser._id, updateDto)
        .pipe(take(1))
        .subscribe({
          next: (savedUser) => {
            this.alerts
              .open(tr('მომხმარებელი წარმატებით განახლდა!'), { appearance: 'success' })
              .pipe(take(1))
              .subscribe();
            this.context.completeWith(savedUser);
          },
          error: () => {
            this.alerts
              .open(tr('შეცდომა მომხმარებლის განახლებისას.'), { appearance: 'error' })
              .pipe(take(1))
              .subscribe();
          },
        });
    } else {
      const createDto: CreateUserDto = {
        email: formValue.email,
        password: formValue.password,
        firstName: formValue.firstName || undefined,
        lastName: formValue.lastName || undefined,
        ...identity,
        pid: formValue.pid || undefined,
        dateOfBirth,
        userType: formValue.userType,
      };

      this.userService
        .createUser(createDto)
        .pipe(take(1))
        .subscribe({
          next: (savedUser) => {
            this.alerts
              .open(tr('მომხმარებელი წარმატებით დაემატა!'), { appearance: 'success' })
              .pipe(take(1))
              .subscribe();
            this.context.completeWith(savedUser);
          },
          error: () => {
            this.alerts
              .open(tr('შეცდომა მომხმარებლის დამატებისას.'), { appearance: 'error' })
              .pipe(take(1))
              .subscribe();
          },
        });
    }
  }

  /** Role checkbox helpers (multi-role selection without a multiselect widget). */
  protected isRoleChecked(type: UserType): boolean {
    return (this.userForm.get('userType')?.value ?? []).includes(type);
  }

  protected toggleRole(type: UserType): void {
    const control = this.userForm.get('userType');
    const current: UserType[] = control?.value ?? [];
    let next: UserType[];
    if (current.includes(type)) {
      next = current.filter((t) => t !== type);
    } else if (type === UserType.USER) {
      // Player and admin roles are mutually exclusive (API identity split):
      // an admin's phone must never occupy a player registration slot and
      // vice versa, so picking one side drops the other.
      next = [UserType.USER];
    } else {
      next = [...current.filter((t) => t !== UserType.USER), type];
    }
    control?.setValue(next);
    control?.markAsTouched();
    // The required identity field follows the account kind.
    this.applyIdentityValidators();
  }

  onCancel(): void {
    this.context.completeWith(null);
  }
}
