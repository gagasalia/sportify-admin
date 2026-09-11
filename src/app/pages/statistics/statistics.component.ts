import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { AcademySelectComponent } from '../../shared/ui/academy-select.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { FacilityService } from '../../services/http-services/facility.service';
import { CourtService } from '../../services/http-services/court.service';
import { StatsService } from '../../services/http-services/stats.service';
import { Academy } from '../../shared/models/academy.model';
import { Facility } from '../../shared/models/facility.model';
import { Court } from '../../shared/models/court.model';
import {
  StatsCancellations,
  StatsGranularity,
  StatsHeatmap,
  StatsOccupancy,
  StatsOverview,
  StatsQuery,
  StatsRevenue,
  StatsUsers,
} from '../../shared/models/stats.model';
import { SPORT_TYPE_LABELS, SportType } from '../../shared/enums/court-type.enum';
import { isEnglish, liveLabels, tr } from '../../shared/i18n/lang';
import { localizedCourtName, localizedName } from '../../shared/i18n/localized';
import { TPipe } from '../../shared/i18n/t.pipe';
import { downloadCsv } from '../../shared/utils/csv.util';
import { KpiCardComponent } from './charts/kpi-card.component';
import { LineChartComponent, LinePoint } from './charts/line-chart.component';
import { BarListComponent, BarRow } from './charts/bar-list.component';
import { StackBarsComponent, StackRow } from './charts/stack-bars.component';
import { HeatmapGridComponent } from './charts/heatmap-grid.component';

export type StatsTab =
  | 'overview'
  | 'occupancy'
  | 'heatmap'
  | 'revenue'
  | 'users'
  | 'cancellations';

type PresetKey = 'today' | '7d' | '30d' | '90d';

// RAW Georgian values behind a live proxy: every read goes through `tr()`, so
// the labels follow the language toggle instead of baking at import time.
const SEGMENT_LABELS: Record<string, string> = liveLabels({
  casual: 'ერთჯერადი (1–2)',
  regular: 'რეგულარული (3–9)',
  power: 'აქტიური (10+)',
});

const LEAD_LABELS: Record<string, string> = liveLabels({
  '<2h': '< 2 სთ',
  '2-6h': '2–6 სთ',
  '6-24h': '6–24 სთ',
  '1-3d': '1–3 დღე',
  '>3d': '> 3 დღე',
});

/**
 * Statistics module: one page, six views behind segmented tabs, one shared
 * filter bar (date presets + custom range, academy→facility→court cascade,
 * sport). Data is chart-ready from /statistics/*; every view has loading,
 * empty and error states plus CSV export of its primary dataset.
 */
@Component({
  selector: 'app-statistics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    AcademySelectComponent,
    KpiCardComponent,
    LineChartComponent,
    BarListComponent,
    StackBarsComponent,
    HeatmapGridComponent,
    TPipe,
  ],
  templateUrl: './statistics.component.html',
  styleUrls: ['./statistics.component.css'],
})
export class StatisticsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly academyService = inject(AcademyService);
  private readonly facilityService = inject(FacilityService);
  private readonly courtService = inject(CourtService);
  private readonly statsService = inject(StatsService);

  readonly isSuperAdmin = this.auth.isSuperAdmin;

  // ── filters ────────────────────────────────────────────────────────────────
  readonly preset = signal<PresetKey | null>('30d');
  readonly from = signal(this.shift(-29));
  readonly to = signal(this.today());
  readonly academies = signal<Academy[]>([]);
  readonly academyId = signal('');
  readonly facilities = signal<Facility[]>([]);
  readonly facilityId = signal('');
  readonly courts = signal<Court[]>([]);
  readonly courtId = signal('');
  readonly sportType = signal('');
  readonly granularity = signal<StatsGranularity>('day');

  readonly presets: { key: PresetKey; label: string }[] = [
    { key: 'today', label: 'დღეს' },
    { key: '7d', label: '7 დღე' },
    { key: '30d', label: '30 დღე' },
    { key: '90d', label: '90 დღე' },
  ];

  // computed, not a field initializer: SPORT_TYPE_LABELS is a liveLabels proxy,
  // so a one-time Object.entries would bake the construction-time language
  readonly sports = computed(() =>
    Object.entries(SPORT_TYPE_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  );

  // ── tabs + per-view state ──────────────────────────────────────────────────
  readonly tab = signal<StatsTab>('overview');
  readonly tabs: { key: StatsTab; label: string; icon: string }[] = [
    { key: 'overview', label: 'მიმოხილვა', icon: 'layout-grid.svg' },
    { key: 'occupancy', label: 'დატვირთვა', icon: 'chart-column.svg' },
    { key: 'heatmap', label: 'პიკის საათები', icon: 'clock.svg' },
    { key: 'revenue', label: 'შემოსავალი', icon: 'wallet.svg' },
    { key: 'users', label: 'მომხმარებლები', icon: 'users.svg' },
    { key: 'cancellations', label: 'გაუქმებები', icon: 'calendar-off.svg' },
  ];

  readonly isLoading = signal(false);
  readonly hasError = signal(false);

  readonly overview = signal<StatsOverview | null>(null);
  readonly occupancy = signal<StatsOccupancy | null>(null);
  readonly heatmap = signal<StatsHeatmap | null>(null);
  readonly revenue = signal<StatsRevenue | null>(null);
  readonly users = signal<StatsUsers | null>(null);
  readonly cancellations = signal<StatsCancellations | null>(null);

  /** Views whose series honor the granularity toggle. */
  readonly granular = computed(() =>
    ['revenue', 'users', 'cancellations'].includes(this.tab()),
  );

  private requestSeq = 0;

  constructor() {
    // Reload the active view whenever the tab or any filter changes. The
    // backend memoizes ~5 min, so tab-hopping over the same filters is cheap.
    effect(() => {
      const tab = this.tab();
      const query = this.query();
      untracked(() => this.load(tab, query));
    });
  }

  ngOnInit(): void {
    if (this.isSuperAdmin()) {
      this.academyService
        .getAllAcademies()
        .pipe(take(1))
        .subscribe((academies) => this.academies.set(academies));
    } else {
      // Admins are pinned to their academy server-side; the tenant id is only
      // needed to feed the facility cascade.
      this.tenant
        .ensure()
        .pipe(take(1))
        .subscribe((academy) => {
          if (academy?._id) {
            this.loadFacilities(academy._id);
          }
        });
    }
  }

  // ── query assembly ─────────────────────────────────────────────────────────
  readonly query = computed<StatsQuery>(() => ({
    from: this.from(),
    to: this.to(),
    academyId: this.academyId() || undefined,
    facilityId: this.facilityId() || undefined,
    courtId: this.courtId() || undefined,
    sportType: this.sportType() || undefined,
    granularity: this.granularity(),
  }));

  private load(tab: StatsTab, query: StatsQuery): void {
    const seq = ++this.requestSeq;
    this.isLoading.set(true);
    this.hasError.set(false);
    const done = <T>(store: (value: T) => void) => ({
      next: (value: T) => {
        if (seq !== this.requestSeq) {
          return;
        }
        store(value);
        this.isLoading.set(false);
      },
      error: () => {
        if (seq !== this.requestSeq) {
          return;
        }
        this.hasError.set(true);
        this.isLoading.set(false);
      },
    });
    switch (tab) {
      case 'overview':
        this.statsService
          .getOverview(query)
          .pipe(take(1))
          .subscribe(done((v) => this.overview.set(v)));
        break;
      case 'occupancy':
        this.statsService
          .getOccupancy(query)
          .pipe(take(1))
          .subscribe(done((v) => this.occupancy.set(v)));
        break;
      case 'heatmap':
        this.statsService
          .getHeatmap(query)
          .pipe(take(1))
          .subscribe(done((v) => this.heatmap.set(v)));
        break;
      case 'revenue':
        this.statsService
          .getRevenue(query)
          .pipe(take(1))
          .subscribe(done((v) => this.revenue.set(v)));
        break;
      case 'users':
        this.statsService
          .getUsers(query)
          .pipe(take(1))
          .subscribe(done((v) => this.users.set(v)));
        break;
      case 'cancellations':
        this.statsService
          .getCancellations(query)
          .pipe(take(1))
          .subscribe(done((v) => this.cancellations.set(v)));
        break;
    }
  }

  retry(): void {
    this.load(this.tab(), this.query());
  }

  // ── filter interactions ────────────────────────────────────────────────────
  setTab(tab: StatsTab): void {
    this.tab.set(tab);
  }

  applyPreset(key: PresetKey): void {
    this.preset.set(key);
    const spans: Record<PresetKey, number> = {
      today: 0,
      '7d': 6,
      '30d': 29,
      '90d': 89,
    };
    this.from.set(this.shift(-spans[key]));
    this.to.set(this.today());
  }

  onFromChange(value: string): void {
    if (value) {
      this.preset.set(null);
      this.from.set(value);
      if (value > this.to()) {
        this.to.set(value);
      }
    }
  }

  onToChange(value: string): void {
    if (value) {
      this.preset.set(null);
      this.to.set(value);
      if (value < this.from()) {
        this.from.set(value);
      }
    }
  }

  onAcademyChange(academyId: string): void {
    this.academyId.set(academyId);
    this.facilityId.set('');
    this.courtId.set('');
    this.facilities.set([]);
    this.courts.set([]);
    if (academyId) {
      this.loadFacilities(academyId);
    }
  }

  onFacilityChange(facilityId: string): void {
    this.facilityId.set(facilityId);
    this.courtId.set('');
    this.courts.set([]);
    if (facilityId) {
      this.courtService
        .getCourts(facilityId)
        .pipe(take(1))
        .subscribe((courts) => this.courts.set(courts));
    }
  }

  /**
   * Sense overrides: these Georgian words map to a DIFFERENT meaning in the
   * shared dictionary ('კვირა' → Sunday for weekday labels, 'დაბრუნებული' →
   * Refunded for the money KPI), so the week-granularity chip and the
   * returning-users labels translate locally. isEnglish() reads the language
   * signal, so both stay live across a toggle.
   */
  protected weekWord(): string {
    return isEnglish() ? 'Week' : 'კვირა';
  }

  protected returningWord(): string {
    return isEnglish() ? 'Returning' : 'დაბრუნებული';
  }

  setGranularity(granularity: StatsGranularity): void {
    this.granularity.set(granularity);
  }

  private loadFacilities(academyId: string): void {
    this.facilityService
      .getFacilitiesByAcademy(academyId)
      .pipe(take(1))
      .subscribe((facilities) => this.facilities.set(facilities));
  }

  facilityIdOf(facility: Facility): string {
    return facility._id ?? facility.id ?? '';
  }

  courtIdOf(court: Court): string {
    return court._id ?? court.id ?? '';
  }

  /** Occupancy rows carry a `courtName` / `courtNameEn` snapshot pair. */
  readonly localizedCourtName = localizedCourtName;

  /** Facility / court name for a filter option — English when the operator set one. */
  facilityLabel(facility: Facility): string {
    return localizedName(facility);
  }

  courtLabel(court: Court): string {
    return localizedName(court);
  }

  /**
   * Statistics rows carry a Georgian `facilityName` snapshot only, so an English
   * session resolves the name through the loaded facility list (by id) and keeps
   * the snapshot as the fallback for facilities that are gone.
   */
  facilityLabelById(facilityId: string, fallback: string): string {
    const match = this.facilities().find((f) => this.facilityIdOf(f) === facilityId);
    return (match && localizedName(match)) || fallback;
  }

  // ── formatting ─────────────────────────────────────────────────────────────
  gel(tetri: number | null | undefined): string {
    if (tetri == null) {
      return '—';
    }
    return `${new Intl.NumberFormat('ka-GE', { maximumFractionDigits: 2 }).format(tetri / 100)} ₾`;
  }

  pct(fraction: number | null | undefined): string {
    if (fraction == null) {
      return '—';
    }
    return `${(fraction * 100).toFixed(1)}%`;
  }

  hoursOf(minutes: number): string {
    return `${new Intl.NumberFormat('ka-GE', { maximumFractionDigits: 1 }).format(minutes / 60)} ${tr('სთ')}`;
  }

  num(value: number | null | undefined): string {
    return value == null ? '—' : new Intl.NumberFormat('ka-GE').format(value);
  }

  /** Fractional change current vs previous; null hides the badge. */
  delta(current: number | null, previous: number | null): number | null {
    if (current == null || previous == null || previous === 0) {
      return null;
    }
    return (current - previous) / Math.abs(previous);
  }

  segmentLabel(key: string): string {
    return SEGMENT_LABELS[key] ?? key;
  }

  sportLabel(sportType: string): string {
    return SPORT_TYPE_LABELS[sportType as SportType] ?? sportType;
  }

  // ── chart adapters ─────────────────────────────────────────────────────────
  readonly revenueSeries = computed<LinePoint[]>(
    () =>
      this.revenue()?.series.map((p) => ({
        label: p.bucket,
        value: p.netTetri,
        display: this.gel(p.netTetri),
      })) ?? [],
  );

  readonly revenueByFacility = computed<BarRow[]>(
    () =>
      this.revenue()?.byFacility.map((f) => ({
        label: this.facilityLabelById(f.facilityId, f.facilityName),
        value: f.netTetri,
        display: this.gel(f.netTetri),
      })) ?? [],
  );

  readonly revenueByHour = computed<BarRow[]>(
    () =>
      this.revenue()?.byHour.map((h) => ({
        label: `${String(h.hour).padStart(2, '0')}:00`,
        value: h.netTetri,
        display: this.gel(h.netTetri),
      })) ?? [],
  );

  readonly revenueBySport = computed<BarRow[]>(
    () =>
      this.revenue()?.bySport.map((s) => ({
        label: tr(this.sportLabel(s.sportType)),
        value: s.netTetri,
        display: this.gel(s.netTetri),
      })) ?? [],
  );

  readonly occupancyByFacility = computed<BarRow[]>(
    () =>
      this.occupancy()?.facilities.map((f) => ({
        label: this.facilityLabelById(f.facilityId, f.facilityName),
        value: f.occupancy ?? 0,
        display: this.pct(f.occupancy),
      })) ?? [],
  );

  readonly usersTrend = computed<StackRow[]>(
    () =>
      this.users()?.trend.map((t) => ({
        label: t.bucket,
        parts: [
          { name: tr('ახალი'), value: t.newUsers, color: 'var(--accent)' },
          {
            name: this.returningWord(),
            value: t.returningUsers,
            color: 'var(--success)',
          },
        ],
      })) ?? [],
  );

  readonly userSegments = computed<BarRow[]>(
    () =>
      this.users()?.segments.map((s) => ({
        label: this.segmentLabel(s.key),
        value: s.users,
        display: `${this.num(s.users)} · ${this.gel(s.netTetri)}`,
      })) ?? [],
  );

  readonly cancellationsTrend = computed<StackRow[]>(
    () =>
      this.cancellations()?.trend.map((t) => ({
        label: t.bucket,
        parts: [
          { name: tr('გაუქმებული'), value: t.cancelled, color: 'var(--danger)' },
          {
            name: tr('გამოუცხადებელი'),
            value: t.noShow,
            color: 'var(--warning)',
          },
          {
            name: tr('შემდგარი'),
            value: Math.max(0, t.total - t.cancelled - t.noShow),
            color: 'var(--accent-soft)',
          },
        ],
      })) ?? [],
  );

  readonly leadBuckets = computed<BarRow[]>(
    () =>
      this.cancellations()?.leadBuckets.map((b) => ({
        label: LEAD_LABELS[b.key] ?? b.key,
        value: b.count,
        display: this.num(b.count),
      })) ?? [],
  );

  /** Occupancy meter width, clamped: >100% can happen when hours shrank. */
  occupancyWidth(occupancy: number): number {
    return Math.min(100, occupancy * 100);
  }

  // ── CSV export (primary dataset of the active view) ────────────────────────
  exportCsv(): void {
    const range = `${this.from()}_${this.to()}`;
    switch (this.tab()) {
      case 'overview': {
        const data = this.overview();
        if (!data) return;
        downloadCsv(`overview_${range}`, [
          this.overviewCsvRow('current', data.current),
          this.overviewCsvRow('previous', data.previous),
        ]);
        break;
      }
      case 'occupancy': {
        const data = this.occupancy();
        if (!data) return;
        downloadCsv(
          `occupancy_${range}`,
          data.courts.map((c) => ({
            facility: this.facilityLabelById(c.facilityId, c.facilityName),
            court: localizedCourtName(c),
            sport: c.sportType,
            bookedMinutes: c.bookedMinutes,
            blockedMinutes: c.blockedMinutes,
            availableMinutes: c.availableMinutes,
            occupancy: c.occupancy,
          })),
        );
        break;
      }
      case 'heatmap': {
        const data = this.heatmap();
        if (!data) return;
        downloadCsv(
          `heatmap_${range}`,
          data.cells.map((c) => ({ dow: c.dow, hour: c.hour, count: c.count })),
        );
        break;
      }
      case 'revenue': {
        const data = this.revenue();
        if (!data) return;
        downloadCsv(
          `revenue_${range}`,
          data.series.map((p) => ({
            bucket: p.bucket,
            capturedGel: p.capturedTetri / 100,
            refundedGel: p.refundedTetri / 100,
            netGel: p.netTetri / 100,
          })),
        );
        break;
      }
      case 'users': {
        const data = this.users();
        if (!data) return;
        downloadCsv(
          `users_${range}`,
          data.trend.map((t) => ({
            bucket: t.bucket,
            newUsers: t.newUsers,
            returningUsers: t.returningUsers,
          })),
        );
        break;
      }
      case 'cancellations': {
        const data = this.cancellations();
        if (!data) return;
        downloadCsv(
          `cancellations_${range}`,
          data.trend.map((t) => ({
            bucket: t.bucket,
            total: t.total,
            cancelled: t.cancelled,
            noShow: t.noShow,
          })),
        );
        break;
      }
    }
  }

  private overviewCsvRow(
    period: string,
    s: StatsOverview['current'],
  ): Record<string, string | number | null> {
    return {
      period,
      occupancy: s.occupancy,
      netRevenueGel: s.netRevenueTetri / 100,
      totalBookings: s.totalBookings,
      cancelRate: s.cancelRate,
      newUsers: s.newUsers,
      returningUsers: s.returningUsers,
    };
  }

  // ── dates ──────────────────────────────────────────────────────────────────
  private today(): string {
    return new Date().toLocaleDateString('en-CA');
  }

  private shift(byDays: number): string {
    const date = new Date();
    date.setDate(date.getDate() + byDays);
    return date.toLocaleDateString('en-CA');
  }
}
