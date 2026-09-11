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
import { AcademySelectComponent } from '../../shared/ui/academy-select.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap, take } from 'rxjs';
import { CampaignService } from '../../services/http-services/campaign.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { FacilityNamesService } from '../../shared/i18n/facility-names.service';
import { Academy } from '../../shared/models/academy.model';
import {
  CAMPAIGN_STATUS_CLASSES,
  CAMPAIGN_STATUS_LABELS,
  Campaign,
  CampaignDerivedStatus,
} from '../../shared/models/campaign.model';
import { tetriToGel } from '../../shared/utils/money.util';
import { tr } from '../../shared/i18n/lang';
import { TPipe } from '../../shared/i18n/t.pipe';
import { SsToastService } from '../../shared/ui/toast.service';
import { SsDialogService } from '../../shared/ui/dialog.service';
import { SsConfirmComponent, SsConfirmData } from '../../shared/ui/confirm.component';
import { CampaignFormComponent } from './campaign-form/campaign-form.component';
import { CampaignParticipantsDialogComponent } from './campaign-participants-dialog/campaign-participants-dialog.component';

const PAGE_SIZE = 20;

/**
 * კამპანიები — the operator's loyalty-challenge list (docs/24 §5.1, v2):
 * filterable by active state (plus an academy select for superadmins), with
 * inline activate/deactivate switches, a create/edit dialog, a per-campaign
 * participants dialog, and delete for campaigns nobody has joined (joined
 * ones are retired via the switch instead — deactivation stops NEW entrants,
 * players mid-run keep advancing and can still collect).
 *
 * There is no text search: campaigns store no copy (every sentence is
 * generated from the terms), so the row identity IS the offer — goal · reward
 * · scope · period.
 */
@Component({
  selector: 'app-campaigns',
  standalone: true,
  imports: [CommonModule, FormsModule, AcademySelectComponent, TPipe],
  templateUrl: './campaigns.component.html',
  styleUrl: './campaigns.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CampaignsComponent implements OnInit {
  private readonly campaignService = inject(CampaignService);
  private readonly academyService = inject(AcademyService);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly facilityNames = inject(FacilityNamesService);
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSuperAdmin = this.auth.isSuperAdmin;

  // filters
  protected readonly activeFilter = signal<boolean | null>(null);
  protected readonly academies = signal<Academy[]>([]);
  protected readonly academyId = signal<string>('');

  // list state
  protected readonly rows = signal<Campaign[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly hasError = signal(false);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly limit = PAGE_SIZE;
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit)),
  );
  protected readonly isMobile = signal(window.innerWidth <= 768);

  /** Drops stale responses when filters change faster than the API answers. */
  private requestSeq = 0;

  @HostListener('window:resize')
  protected onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  ngOnInit(): void {
    if (this.isSuperAdmin()) {
      this.academyService
        .getAllAcademies()
        .pipe(take(1))
        .subscribe((academies) => this.academies.set(academies));
    }

    this.facilityNames.ensure();
    this.tenant
      .ensure()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
  }

  // ── filters ────────────────────────────────────────────────────────────────

  protected setActiveFilter(active: boolean | null): void {
    this.activeFilter.set(active);
    this.page.set(1);
    this.load();
  }

  protected onAcademyChange(academyId: string): void {
    this.academyId.set(academyId);
    // A superadmin switching academies needs that academy's names for the chips.
    this.facilityNames.ensureFor(academyId);
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
    this.campaignService
      .getCampaigns({
        page: this.page(),
        limit: this.limit,
        active: this.activeFilter() ?? undefined,
        academyId: this.academyId() || undefined,
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

  // ── dialogs ────────────────────────────────────────────────────────────────

  protected addCampaign(): void {
    this.dialogs
      .open<Campaign | null>(CampaignFormComponent, {
        label: tr('კამპანიის დამატება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: {},
      })
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.load();
          this.alerts.open(tr('შეიქმნა'), { appearance: 'success' }).pipe(take(1)).subscribe();
        }
      });
  }

  protected editCampaign(campaign: Campaign): void {
    this.dialogs
      .open<Campaign | null>(CampaignFormComponent, {
        label: tr('კამპანიის რედაქტირება'),
        size: 'l',
        dismissible: true,
        closable: true,
        data: { campaign },
      })
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.load();
          this.alerts.open(tr('შეინახა'), { appearance: 'success' }).pipe(take(1)).subscribe();
        }
      });
  }

  protected openParticipants(campaign: Campaign): void {
    this.dialogs
      .open<void>(CampaignParticipantsDialogComponent, {
        label: `${tr('მონაწილეები')} · ${this.offerLabel(campaign)}`,
        size: 'l',
        dismissible: true,
        closable: true,
        data: { campaign },
      })
      .pipe(take(1))
      .subscribe();
  }

  protected deleteCampaign(campaign: Campaign): void {
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('კამპანიის წაშლა'),
        size: 's',
        data: {
          content: `${tr('ნამდვილად წაშალოთ კამპანია')} „${this.offerLabel(campaign)}"?`,
          yes: tr('წაშლა'),
          no: tr('გაუქმება'),
          appearance: 'destructive',
        } as SsConfirmData,
      })
      .pipe(
        take(1),
        filter(Boolean),
        switchMap(() => this.campaignService.deleteCampaign(campaign._id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.load();
          this.alerts.open(tr('წაიშალა'), { appearance: 'success' }).pipe(take(1)).subscribe();
        },
        error: () => {
          this.alerts
            .open(tr('წაშლა ვერ მოხერხდა, სცადეთ თავიდან'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  // ── inline active switch ───────────────────────────────────────────────────

  /** Optimistic flip: the row updates immediately and reverts on error. */
  protected onActiveToggle(campaign: Campaign, active: boolean): void {
    if (campaign.active === active) return;
    const previous = campaign.active;
    this.rows.update((list) =>
      list.map((c) => (c._id === campaign._id ? { ...c, active } : c)),
    );
    this.campaignService
      .updateCampaign(campaign._id, { active })
      .pipe(take(1))
      .subscribe({
        next: (updated) => {
          this.rows.update((list) =>
            list.map((c) => (c._id === updated._id ? updated : c)),
          );
          this.alerts.open(tr('შეინახა'), { appearance: 'success' }).pipe(take(1)).subscribe();
        },
        error: () => {
          this.rows.update((list) =>
            list.map((c) => (c._id === campaign._id ? { ...c, active: previous } : c)),
          );
          this.alerts
            .open(tr('შენახვა ვერ მოხერხდა, სცადეთ თავიდან'), { appearance: 'error' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  // ── display helpers ────────────────────────────────────────────────────────

  /**
   * Derive the display status: inactive → expired → scheduled → live. A
   * date-only `endsAt` counts to the END of that day (matching the server).
   */
  protected derivedStatus(c: Campaign): CampaignDerivedStatus {
    if (!c.active) return 'inactive';
    if (c.endsAt && this.endTime(c.endsAt) <= Date.now()) return 'expired';
    if (c.startsAt && new Date(c.startsAt).getTime() > Date.now()) return 'scheduled';
    return 'live';
  }

  private endTime(endsAt: string): number {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(endsAt);
    return new Date(dateOnly ? `${endsAt}T23:59:59.999` : endsAt).getTime();
  }

  protected statusLabel(status: CampaignDerivedStatus): string {
    return CAMPAIGN_STATUS_LABELS[status] ?? status;
  }

  protected statusClass(status: CampaignDerivedStatus): string {
    return CAMPAIGN_STATUS_CLASSES[status] ?? CAMPAIGN_STATUS_CLASSES.inactive;
  }

  /** '5 ჯავშანი' / '300 ₾' — the goal in its own unit. */
  protected goalLabel(c: Campaign): string {
    return c.goalType === 'spend'
      ? `${tetriToGel(c.goalTarget)} ₾`
      : tr('%s ჯავშანი').replace('%s', String(c.goalTarget));
  }

  /**
   * THE generated offer sentence (docs/24 v2 — campaigns store no copy): the
   * row identity, the dialog headline, exactly what a player reads.
   */
  protected offerLabel(c: Campaign): string {
    const reward = tetriToGel(c.rewardTetri);
    // ONE translatable sentence per goal type (%s = goal, %n = reward): the
    // word order differs per language, so it must not be concatenated here.
    return c.goalType === 'spend'
      ? tr('დახარჯე %s ₾ და მიიღე %n ₾')
          .replace('%s', String(tetriToGel(c.goalTarget)))
          .replace('%n', String(reward))
      : tr('ითამაშე %s-ჯერ და მიიღე %n ₾')
          .replace('%s', String(c.goalTarget))
          .replace('%n', String(reward));
  }

  /** '20 ₾ ვაუჩერი' + the validity hint when the reward expires. */
  protected rewardLabel(c: Campaign): string {
    return `${tetriToGel(c.rewardTetri)} ₾`;
  }

  protected rewardHint(c: Campaign): string | null {
    return c.rewardValidDays ? tr('ვადა %s დღე').replace('%s', String(c.rewardValidDays)) : null;
  }

  /** The venues in scope, or 'ყველა მოედანი' for an academy-wide campaign. */
  protected scopeLabel(c: Campaign): string {
    if (c.facilityNames.length === 0) {
      return c.academy ? tr('ყველა მოედანი') : tr('პლატფორმა');
    }
    const names = c.facilityNames.map((name, i) => this.facilityNames.label(c.facilities[i], name));
    if (names.length <= 2) {
      return names.join(' · ');
    }
    return `${names[0]} +${names.length - 1}`;
  }

  /** 'DD.MM.YY – DD.MM.YY' publication window, or 'უვადო' when unbounded. */
  protected periodLabel(c: Campaign): string {
    if (!c.startsAt && !c.endsAt) return tr('უვადო');
    const from = c.startsAt ? this.fmtDate(c.startsAt) : '…';
    const to = c.endsAt ? this.fmtDate(c.endsAt) : '…';
    return `${from} – ${to}`;
  }

  private fmtDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : value;
  }

  /** 'joined / completed' — the campaign's reach at a glance. */
  protected participantsLabel(c: Campaign): string {
    return `${c.enrolledCount} / ${c.completedCount}`;
  }
}
