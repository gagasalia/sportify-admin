import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
  HostListener,
  OnInit,
  DestroyRef,
  } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap, take } from 'rxjs';
import { AcademyService } from '../../../services/http-services/academy.service';
import { Academy } from '../../../shared/models/academy.model';
import { AcademyFormComponent } from './academy-form/academy-form.component';
import { tr } from '../../../shared/i18n/lang';
import { TPipe } from '../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../shared/ui/toast.service';
import { SsDialogService } from '../../../shared/ui/dialog.service';
import { SsConfirmComponent, SsConfirmData } from '../../../shared/ui/confirm.component';
@Component({
  selector: 'app-academies-management',
  standalone: true,
  imports: [TPipe],
  templateUrl: './academies-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcademiesManagementComponent implements OnInit {
  private readonly academyService = inject(AcademyService);
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
    private readonly destroyRef = inject(DestroyRef);

  protected readonly academies = signal<Academy[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly isMobile = signal(window.innerWidth <= 768);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly limit = 20;
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit)),
  );

  @HostListener('window:resize')
  protected onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  ngOnInit(): void {
    this.loadAcademies();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.loadAcademies();
  }

  private loadAcademies(): void {
    this.isLoading.set(true);
    this.academyService
      .getAcademiesPage(this.page(), this.limit)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data, page }) => {
          this.academies.set(data);
          this.total.set(page?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
        },
      });
  }

  protected addAcademy(): void {
    this.dialogs
      .open<Academy | null>(AcademyFormComponent, {
        label: tr('აკადემიის დამატება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: {},
      })
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.loadAcademies();
        }
      });
  }

  protected editAcademy(academy: Academy): void {
    this.dialogs
      .open<Academy | null>(AcademyFormComponent, {
        label: tr('აკადემიის რედაქტირება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: { academy },
      })
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.loadAcademies();
        }
      });
  }

  protected formatAdmins(admins: Academy['admins']): string {
    return admins
      .map((a) => (typeof a === 'string' ? a : [a.firstName, a.lastName].filter(Boolean).join(' ')))
      .join(', ');
  }

  protected deleteAcademy(academy: Academy): void {
    if (!academy._id) return;

    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('აკადემიის წაშლა'),
        size: 's',
        data: {
          content: `${tr('ნამდვილად გსურთ')} "${academy.name}"${tr(' - ის წაშლა?')}`,
          yes: tr('წაშლა'),
          no: tr('გაუქმება'),
        } as SsConfirmData,
      })
      .pipe(
        take(1),
        filter(Boolean),
        switchMap(() => this.academyService.deleteAcademy(academy._id!)),
      )
      .subscribe({
        next: () => {
          // Reload instead of splicing locally — keeps the page/total honest.
          this.loadAcademies();
          this.alerts
            .open(tr('აკადემია წარმატებით წაიშალა!'), { appearance: 'success' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }
}
