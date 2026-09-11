import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  HostListener,
  OnInit,
  DestroyRef,
  effect,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { HttpContext } from '@angular/common/http';
import { Subject, filter, switchMap, take, debounceTime } from 'rxjs';
import { SKIP_LOADING } from '../../../shared/interceptors/loading.interceptor';
import { UserManagementService } from '../../../services/http-services/user-management.service';
import { User, UserType, FilterUsersDto } from '../../../shared/models/user.model';
import { UserFormComponent } from './user-form/user-form.component';
import { UserBalanceComponent } from './user-balance/user-balance.component';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { SsToastService } from '../../../shared/ui/toast.service';
import { SsDialogService } from '../../../shared/ui/dialog.service';
import { SsConfirmComponent, SsConfirmData } from '../../../shared/ui/confirm.component';
import { SsAvatarComponent } from '../../../shared/ui/ss-avatar.component';
import { formatMemberId, parseMemberId } from '../../../shared/utils/member-id.util';
import { tr } from '../../../shared/i18n/lang';
import { TPipe } from '../../../shared/i18n/t.pipe';
const DEFAULT_PAGE_SIZE = 20;

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [DatePipe, FormsModule, SsAvatarComponent, TPipe],
  templateUrl: './user-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserManagementComponent implements OnInit {
  private readonly userService = inject(UserManagementService);
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
    private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);

  protected readonly users = signal<User[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly isMobile = signal(window.innerWidth <= 768);

  protected readonly filterName = signal('');
  protected readonly filterEmail = signal('');
  protected readonly filterPhone = signal('');
  protected readonly filterPid = signal('');
  /** Public member ID digits ("42" / "000042"); '' = unset. */
  protected readonly filterMemberId = signal('');
  protected readonly filterRole = signal<UserType | null>(null);
  protected readonly roleOptions = Object.values(UserType);

  // Pagination state (1-based page for the API, 0-based index for TuiPagination)
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly limit = DEFAULT_PAGE_SIZE;
  protected readonly totalPages = computed(() => Math.ceil(this.total() / this.limit));

  private readonly filterChanged$ = new Subject<void>();
  private firstFilterRun = true;
  // When set, the next effect run skips the debounced reload. Used by code paths that
  // already trigger an explicit load right after setting the filter signals (clearFilters,
  // URL-seeded init) so we never fire a duplicate /um/find request.
  private suppressNextFilterEffect = false;

  constructor() {
    effect(() => {
      // Track every filter signal first so the effect re-runs whenever any of them
      // change. Tracking MUST happen before any early return, otherwise the effect
      // would stop reacting to later changes.
      this.filterName();
      this.filterEmail();
      this.filterPhone();
      this.filterPid();
      this.filterMemberId();
      this.filterRole();

      // Skip the effect's initial run (registration/seed from query params) — only
      // genuine user-driven filter changes should trigger a debounced reload. If the
      // initial query-param seeding was batched into this same first run, also clear
      // the suppress flag so it never dangles into a later genuine change.
      if (this.firstFilterRun) {
        this.firstFilterRun = false;
        this.suppressNextFilterEffect = false;
        return;
      }

      // Skip exactly one run when a code path already performs its own explicit load
      // right after mutating the filter signals (clearFilters / URL-seeded init).
      if (this.suppressNextFilterEffect) {
        this.suppressNextFilterEffect = false;
        return;
      }

      // Any filter change resets back to the first page.
      this.page.set(1);
      this.filterChanged$.next();
    });
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  ngOnInit(): void {
    // 1. Read query params on init, populate signals, trigger initial search.
    // Seeding the filter signals re-triggers the tracking effect (firstFilterRun is
    // already consumed by the effect's registration run). Suppress that one effect run
    // so the explicit loadUsers below remains the single initial /um/find call.
    // NOTE: Angular batches effects per tick — all signal sets in this synchronous block
    // collapse into ONE effect run, so a single suppress-once flag is sufficient.
    this.route.queryParams.pipe(take(1)).subscribe((params) => {
      const hasSeed =
        !!params['name'] ||
        !!params['email'] ||
        !!params['phone'] ||
        !!params['pid'] ||
        !!params['memberId'] ||
        !!params['role'];
      if (hasSeed) this.suppressNextFilterEffect = true;

      if (params['name']) this.filterName.set(params['name']);
      if (params['email']) this.filterEmail.set(params['email']);
      if (params['phone']) this.filterPhone.set(params['phone']);
      if (params['pid']) this.filterPid.set(params['pid']);
      if (params['memberId']) this.filterMemberId.set(params['memberId']);
      if (params['role']) this.filterRole.set(params['role'] as UserType);
      const parsedPage = Number(params['page']);
      if (parsedPage >= 1) this.page.set(parsedPage);

      this.loadUsers(this.buildFilters());
    });

    // 2. Debounce filter signal changes → update URL silently + search
    this.filterChanged$
      .pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.syncUrlAndSearch();
      });
  }

  private loadUsers(filters: FilterUsersDto = {}, context?: HttpContext): void {
    if (!context) {
      this.isLoading.set(true);
    }
    this.userService
      .findAllUsers(filters, context)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data, page }) => {
          this.users.set(data);
          this.total.set(page?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
        },
      });
  }

  protected clearFilters(): void {
    // Suppress the debounced reload the effect would otherwise queue when the filter
    // signals change — clearFilters performs its own explicit load below, so without
    // this we'd fire two /um/find calls per clear.
    this.suppressNextFilterEffect = true;

    this.filterName.set('');
    this.filterEmail.set('');
    this.filterPhone.set('');
    this.filterPid.set('');
    this.filterMemberId.set('');
    this.filterRole.set(null);
    this.page.set(1);

    const filters = this.buildFilters();
    this.replaceUrl(filters);
    this.loadUsers(filters, new HttpContext().set(SKIP_LOADING, true));
  }

  protected onPageChange(index: number): void {
    // TuiPagination is 0-based; the API is 1-based.
    this.page.set(index + 1);
    this.syncUrlAndSearch();
  }

  private syncUrlAndSearch(): void {
    const filters = this.buildFilters();
    this.replaceUrl(filters);
    this.loadUsers(filters, new HttpContext().set(SKIP_LOADING, true));
  }

  private buildFilters(): FilterUsersDto {
    const filters: FilterUsersDto = { page: this.page(), limit: this.limit };
    const name = this.filterName().trim();
    const email = this.filterEmail().trim();
    const phone = this.filterPhone().trim();
    const pid = this.filterPid().trim();
    const memberId = parseMemberId(this.filterMemberId());
    const role = this.filterRole();

    if (name) filters.name = name;
    if (email) filters.email = email;
    if (phone) filters.phone = phone;
    if (pid) filters.pid = pid;
    if (memberId !== null) filters.memberId = memberId;
    if (role) filters.userType = [role];
    return filters;
  }

  private replaceUrl(filters: FilterUsersDto): void {
    const params = new URLSearchParams();
    if (filters.name) params.set('name', filters.name);
    if (filters.email) params.set('email', filters.email);
    if (filters.phone) params.set('phone', filters.phone);
    if (filters.pid) params.set('pid', filters.pid);
    if (filters.memberId !== undefined) params.set('memberId', String(filters.memberId));
    if (filters.userType?.length) params.set('role', filters.userType[0]);
    if (filters.page && filters.page > 1) params.set('page', String(filters.page));

    const query = params.toString();
    const path = this.route.snapshot.pathFromRoot
      .map((s) => s.url.map((u) => u.path).join('/'))
      .filter(Boolean)
      .join('/');
    this.location.replaceState('/' + path, query);
  }

  protected addUser(): void {
    this.dialogs
      .open<User | null>(UserFormComponent, {
        label: tr('მომხმარებლის დამატება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: {},
      })
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.loadUsers(this.buildFilters());
        }
      });
  }

  protected editUser(user: User): void {
    this.dialogs
      .open<User | null>(UserFormComponent, {
        label: tr('მომხმარებლის რედაქტირება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: { user },
      })
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.loadUsers(this.buildFilters());
        }
      });
  }

  /** Opens the wallet dialog: balance, manual adjust (+/−) and the ledger. */
  protected manageBalance(user: User): void {
    if (!user._id) return;

    this.dialogs
      .open<void>(UserBalanceComponent, {
        label: tr('ბალანსის მართვა'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: { user },
      })
      .pipe(take(1))
      .subscribe();
  }

  protected deleteUser(user: User): void {
    if (!user._id) return;

    const name = this.getFullName(user);

    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('მომხმარებლის წაშლა'),
        size: 's',
        data: {
          content: `${tr('ნამდვილად გსურთ')} ${name}${tr(' - ის წაშლა?')}`,
          yes: tr('წაშლა'),
          no: tr('გაუქმება'),
        } as SsConfirmData,
      })
      .pipe(
        take(1),
        filter(Boolean),
        switchMap(() => this.userService.deleteUser(user._id!)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.users.update((users) => users.filter((u) => u._id !== user._id));
          this.alerts
            .open(tr('მომხმარებელი წარმატებით წაიშალა!'), { appearance: 'success' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  protected getUserTypeLabel(types: UserType[]): string {
    return types?.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(', ') ?? '—';
  }

  protected getFullName(user: User): string {
    const parts = [user.firstName, user.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : '—';
  }

  /** Public member ID, zero-padded ("000042"); '—' until the API backfill runs. */
  protected getMemberId(user: User): string {
    return formatMemberId(user.memberId) || '—';
  }

  protected getInitials(user: User): string {
    const first = user.firstName?.charAt(0) ?? '';
    const last = user.lastName?.charAt(0) ?? '';
    return (first + last).toUpperCase() || user.email.charAt(0).toUpperCase();
  }
}
