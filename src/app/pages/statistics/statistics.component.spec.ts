import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApplicationRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { StatisticsComponent } from './statistics.component';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { FacilityService } from '../../services/http-services/facility.service';
import { CourtService } from '../../services/http-services/court.service';
import { StatsService } from '../../services/http-services/stats.service';
import { TPipe } from '../../shared/i18n/t.pipe';
import {
  StatsOverview,
  StatsRevenue,
} from '../../shared/models/stats.model';

const overview: StatsOverview = {
  current: {
    occupancy: 0.3,
    netRevenueTetri: 13000,
    totalBookings: 5,
    cancelRate: 0.2,
    newUsers: 1,
    returningUsers: 0,
  },
  previous: {
    occupancy: 0.2,
    netRevenueTetri: 10000,
    totalBookings: 4,
    cancelRate: 0.25,
    newUsers: 2,
    returningUsers: 1,
  },
  previousRange: { from: '2026-06-04', to: '2026-07-03' },
};

const revenue: StatsRevenue = {
  series: [{ bucket: '2026-08-01', capturedTetri: 100, refundedTetri: 0, netTetri: 100 }],
  byFacility: [],
  bySport: [],
  byHour: [],
  totals: { capturedTetri: 100, refundedTetri: 0, netTetri: 100 },
};

function localDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toLocaleDateString('en-CA');
}

describe('StatisticsComponent', () => {
  let component: StatisticsComponent;
  let fixture: ComponentFixture<StatisticsComponent>;
  let statsSpy: jasmine.SpyObj<StatsService>;
  let facilitySpy: jasmine.SpyObj<FacilityService>;
  let courtSpy: jasmine.SpyObj<CourtService>;
  let academySpy: jasmine.SpyObj<AcademyService>;

  async function setup(superAdmin: boolean) {
    statsSpy = jasmine.createSpyObj<StatsService>('StatsService', [
      'getOverview',
      'getOccupancy',
      'getHeatmap',
      'getRevenue',
      'getUsers',
      'getCancellations',
    ]);
    statsSpy.getOverview.and.returnValue(of(overview));
    statsSpy.getRevenue.and.returnValue(of(revenue));
    facilitySpy = jasmine.createSpyObj<FacilityService>('FacilityService', [
      'getFacilitiesByAcademy',
    ]);
    facilitySpy.getFacilitiesByAcademy.and.returnValue(
      of([{ _id: 'fac-1', name: 'Vake' } as never]),
    );
    courtSpy = jasmine.createSpyObj<CourtService>('CourtService', ['getCourts']);
    courtSpy.getCourts.and.returnValue(of([{ _id: 'c-1', name: 'კორტი 1' } as never]));
    academySpy = jasmine.createSpyObj<AcademyService>('AcademyService', [
      'getAllAcademies',
    ]);
    academySpy.getAllAcademies.and.returnValue(
      of([{ _id: 'aca-1', name: 'A1' } as never]),
    );

    await TestBed.configureTestingModule({
      imports: [StatisticsComponent],
      providers: [
        { provide: AuthService, useValue: { isSuperAdmin: () => superAdmin } },
        {
          provide: TenantService,
          useValue: { ensure: () => of({ _id: 'aca-1', name: 'Mine' }) },
        },
        { provide: AcademyService, useValue: academySpy },
        { provide: FacilityService, useValue: facilitySpy },
        { provide: CourtService, useValue: courtSpy },
        { provide: StatsService, useValue: statsSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(StatisticsComponent, {
        // The override REPLACES the component's imports — the template's `| t`
        // still needs the pipe (NO_ERRORS_SCHEMA does not cover unknown pipes).
        set: { imports: [TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(StatisticsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  }

  describe('as an academy admin', () => {
    beforeEach(async () => setup(false));

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('loads the overview for the default 30-day range without an academy filter', () => {
      expect(statsSpy.getOverview).toHaveBeenCalled();
      const query = statsSpy.getOverview.calls.mostRecent().args[0];
      expect(query.from).toBe(localDate(-29));
      expect(query.to).toBe(localDate(0));
      expect(query.academyId).toBeUndefined();
    });

    it('feeds the facility cascade from the tenant academy', () => {
      expect(facilitySpy.getFacilitiesByAcademy).toHaveBeenCalledWith('aca-1');
      expect(component.facilities().length).toBe(1);
    });

    it('switching to the revenue tab requests revenue with the granularity', () => {
      component.setTab('revenue');
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();

      expect(statsSpy.getRevenue).toHaveBeenCalled();
      const query = statsSpy.getRevenue.calls.mostRecent().args[0];
      expect(query.granularity).toBe('day');
    });

    it('selecting a facility loads its courts and scopes the next request', () => {
      component.onFacilityChange('fac-1');
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();

      expect(courtSpy.getCourts).toHaveBeenCalledWith('fac-1');
      const query = statsSpy.getOverview.calls.mostRecent().args[0];
      expect(query.facilityId).toBe('fac-1');
    });

    it('presets rewrite the range (7d = today-6 … today)', () => {
      component.applyPreset('7d');
      expect(component.from()).toBe(localDate(-6));
      expect(component.to()).toBe(localDate(0));
      expect(component.preset()).toBe('7d');
    });

    it('a manual date edit clears the preset chip', () => {
      component.onFromChange(localDate(-3));
      expect(component.preset()).toBeNull();
      expect(component.from()).toBe(localDate(-3));
    });
  });

  describe('as a superadmin', () => {
    beforeEach(async () => setup(true));

    it('offers the academy cascade instead of a pinned tenant', () => {
      expect(academySpy.getAllAcademies).toHaveBeenCalled();
      expect(component.academies().length).toBe(1);
      // No academy chosen yet → no facilities to choose from.
      expect(component.facilities().length).toBe(0);
    });

    it('choosing an academy loads its facilities and filters requests', () => {
      component.onAcademyChange('aca-1');
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();

      expect(facilitySpy.getFacilitiesByAcademy).toHaveBeenCalledWith('aca-1');
      const query = statsSpy.getOverview.calls.mostRecent().args[0];
      expect(query.academyId).toBe('aca-1');
    });
  });

  describe('formatting helpers', () => {
    beforeEach(async () => setup(false));

    it('formats tetri as GEL and fractions as percentages', () => {
      expect(component.gel(13000)).toContain('130');
      expect(component.gel(null)).toBe('—');
      expect(component.pct(0.335)).toBe('33.5%');
      expect(component.pct(null)).toBe('—');
    });

    it('computes fractional deltas and hides them when the base is empty', () => {
      expect(component.delta(130, 100)).toBeCloseTo(0.3, 10);
      expect(component.delta(100, 0)).toBeNull();
      expect(component.delta(null, 100)).toBeNull();
    });
  });
});
