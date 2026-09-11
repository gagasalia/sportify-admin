import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AcademySelectComponent } from '../../shared/ui/academy-select.component';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, debounceTime, take } from 'rxjs';
import { tr } from '../../shared/i18n/lang';
import { TPipe } from '../../shared/i18n/t.pipe';
import { CustomersService } from '../../services/http-services/customers.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { AuthService } from '../../shared/services/auth.service';
import { Academy } from '../../shared/models/academy.model';
import {
  CustomerFlagFilter,
  CustomerRow,
} from '../../shared/models/customer.model';
import { SsAvatarComponent } from '../../shared/ui/ss-avatar.component';
import { formatMemberId } from '../../shared/utils/member-id.util';

const PAGE_SIZE = 20;

/**
 * მომხმარებლები — the operator's customer directory: players with booking
 * activity in the caller's scope, searchable, with per-player stats and
 * moderation badges. A row opens the customer detail page.
 */
@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [DatePipe, FormsModule, SsAvatarComponent, AcademySelectComponent, TPipe],
  templateUrl: './customers.component.html',
  styleUrl: './customers.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomersComponent implements OnInit {
  private readonly customersService = inject(CustomersService);
  private readonly academyService = inject(AcademyService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSuperAdmin = this.auth.isSuperAdmin;

  protected readonly q = signal('');
  protected readonly flag = signal<CustomerFlagFilter | null>(null);
  protected readonly academies = signal<Academy[]>([]);
  protected readonly academyId = signal<string>('');

  protected readonly rows = signal<CustomerRow[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly hasError = signal(false);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly limit = PAGE_SIZE;
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit)),
  );
  protected readonly isMobile = signal(window.innerWidth <= 768);

  /** Drops stale responses when the user types faster than the API answers. */
  private requestSeq = 0;
  private readonly search$ = new Subject<void>();

  @HostListener('window:resize')
  protected onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  ngOnInit(): void {
    this.search$
      .pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.page.set(1);
        this.load();
      });

    if (this.isSuperAdmin()) {
      this.academyService
        .getAllAcademies()
        .pipe(take(1))
        .subscribe((academies) => this.academies.set(academies));
    }
    this.load();
  }

  protected onSearchChange(value: string): void {
    this.q.set(value);
    this.search$.next();
  }

  protected setFlag(flag: CustomerFlagFilter | null): void {
    this.flag.set(flag);
    this.page.set(1);
    this.load();
  }

  protected onAcademyChange(academyId: string): void {
    this.academyId.set(academyId);
    this.page.set(1);
    this.load();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected retry(): void {
    this.load();
  }

  private load(): void {
    const seq = ++this.requestSeq;
    this.isLoading.set(true);
    this.hasError.set(false);
    this.customersService
      .list({
        q: this.q().trim() || undefined,
        flag: this.flag() ?? undefined,
        academyId: this.academyId() || undefined,
        page: this.page(),
        limit: this.limit,
      })
      .pipe(take(1))
      .subscribe({
        next: ({ data, page }) => {
          if (seq !== this.requestSeq) return;
          this.rows.set(data);
          this.total.set(page?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: () => {
          if (seq !== this.requestSeq) return;
          this.isLoading.set(false);
          this.hasError.set(true);
        },
      });
  }

  protected open(row: CustomerRow): void {
    // A deleted account still shows its history line but has no detail page.
    // Presence of the phone (the account identifier since the phone-only
    // migration — email is no longer served) marks a live account.
    if (!row.phone) return;
    void this.router.navigate(['/customers', row.userId]);
  }

  // ── display helpers ────────────────────────────────────────────────────────

  protected fullName(row: CustomerRow): string {
    const parts = [row.firstName, row.lastName].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    return row.email ?? tr('წაშლილი ანგარიში');
  }

  protected initials(row: CustomerRow): string {
    const first = row.firstName?.charAt(0) ?? '';
    const last = row.lastName?.charAt(0) ?? '';
    return (first + last).toUpperCase() || (row.email?.charAt(0) ?? '?').toUpperCase();
  }

  protected gel(tetri: number | null | undefined): string {
    if (tetri == null) return '—';
    return `${new Intl.NumberFormat('ka-GE', { maximumFractionDigits: 2 }).format(tetri / 100)} ₾`;
  }

  /** Public member ID, zero-padded ("000042"); '' for legacy/deleted accounts. */
  protected memberIdOf(row: CustomerRow): string {
    return formatMemberId(row.memberId);
  }

  /** Mobile card subtitle: "ID 000042 · +9955…" (whichever parts exist). */
  protected mobileSubtitle(row: CustomerRow): string {
    const id = formatMemberId(row.memberId);
    const parts = [id ? `ID ${id}` : '', row.phone ?? ''].filter(Boolean);
    return parts.join(' · ') || '—';
  }
}
