import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { take } from 'rxjs';
import { AcademyService } from '../../../../services/http-services/academy.service';
import { UserManagementService } from '../../../../services/http-services/user-management.service';
import { Academy, AcademyStatus } from '../../../../shared/models/academy.model';
import { User, UserType } from '../../../../shared/models/user.model';
import { arrayRequiredValidator } from '../../../../shared/validators/array-required.validator';
import { tr } from '../../../../shared/i18n/lang';
import { TPipe } from '../../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../../shared/ui/toast.service';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../../../shared/ui/dialog.service';
@Component({
  selector: 'app-academy-form',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, TPipe],
  templateUrl: './academy-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcademyFormComponent implements OnInit {
  academyForm!: FormGroup;

  protected readonly adminUsers = signal<User[]>([]);
  protected readonly isLoadingUsers = signal(true);

  protected readonly statusOptions = [AcademyStatus.PUBLISHED, AcademyStatus.UNPUBLISHED];

  readonly stringifyUser = (user: User): string => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    return name ? `${name} (${user.email})` : user.email;
  };

  /** Admin checkbox helpers (multi-admin selection without a multiselect widget). */
  protected isAdminChecked(user: User): boolean {
    const current: User[] = this.academyForm.get('admins')?.value ?? [];
    return current.some((u) => u._id === user._id);
  }

  protected toggleAdmin(user: User): void {
    const control = this.academyForm.get('admins');
    const current: User[] = control?.value ?? [];
    const next = current.some((u) => u._id === user._id)
      ? current.filter((u) => u._id !== user._id)
      : [...current, user];
    control?.setValue(next);
    control?.markAsTouched();
  }

  readonly stringifyStatus = (status: AcademyStatus): string => {
    switch (status) {
      case AcademyStatus.PUBLISHED:
        return 'გამოქვეყნებული';
      case AcademyStatus.UNPUBLISHED:
        return 'გამოუქვეყნებელი';
      default:
        return status;
    }
  };

  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    Academy | null,
    { academy?: Academy }
  >;
  private readonly fb = inject(FormBuilder);
  private readonly academyService = inject(AcademyService);
  private readonly userService = inject(UserManagementService);
  private readonly alerts = inject(SsToastService);

  protected get isEditMode(): boolean {
    return !!this.context.data?.academy;
  }

  ngOnInit(): void {
    const a = this.context.data?.academy;

    this.academyForm = this.fb.group({
      name: [a?.name || '', Validators.required],
      admins: [[], [arrayRequiredValidator]],
    });

    // Status is only editable in edit mode — academies start unpublished server-side.
    if (this.isEditMode) {
      this.academyForm.addControl(
        'status',
        this.fb.control(a?.status || AcademyStatus.UNPUBLISHED, Validators.required),
      );
    }

    this.userService
      .findAllUsers({ userType: [UserType.ADMIN, UserType.SUPERADMIN] })
      .pipe(take(1))
      .subscribe({
        next: ({ data: users }) => {
          const filtered = users.filter((u) =>
            u.userType?.some((type) => type === UserType.ADMIN || type === UserType.SUPERADMIN),
          );
          this.adminUsers.set(filtered);
          this.isLoadingUsers.set(false);

          if (a?.admins?.length) {
            const adminIds = a.admins.map((admin) =>
              typeof admin === 'string' ? admin : admin._id,
            );
            const matched = filtered.filter((u) => adminIds.includes(u._id));
            this.academyForm.get('admins')?.setValue(matched);
          }
        },
        error: () => {
          this.isLoadingUsers.set(false);
        },
      });
  }

  onSubmit(): void {
    if (this.academyForm.invalid) return;

    const v = this.academyForm.value;
    const a = this.context.data?.academy;

    if (a?._id) {
      this.academyService
        .updateAcademy(a._id, {
          name: v.name,
          admins: v.admins.map((u: User) => u._id),
          status: v.status,
        })
        .pipe(take(1))
        .subscribe({
          next: (saved) => {
            this.alerts
              .open(tr('აკადემია წარმატებით განახლდა!'), { appearance: 'success' })
              .pipe(take(1))
              .subscribe();
            this.context.completeWith(saved);
          },
          error: () => {
            this.alerts
              .open(tr('შეცდომა აკადემიის განახლებისას.'), { appearance: 'error' })
              .pipe(take(1))
              .subscribe();
          },
        });
    } else {
      this.academyService
        .createAcademy({
          name: v.name,
          admins: v.admins.map((u: User) => u._id),
        })
        .pipe(take(1))
        .subscribe({
          next: (saved) => {
            this.alerts
              .open(tr('აკადემია წარმატებით დაემატა!'), { appearance: 'success' })
              .pipe(take(1))
              .subscribe();
            this.context.completeWith(saved);
          },
          error: () => {
            this.alerts
              .open(tr('შეცდომა აკადემიის დამატებისას.'), { appearance: 'error' })
              .pipe(take(1))
              .subscribe();
          },
        });
    }
  }

  onCancel(): void {
    this.context.completeWith(null);
  }
}
