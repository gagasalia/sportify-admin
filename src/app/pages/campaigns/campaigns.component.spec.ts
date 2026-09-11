import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { CampaignsComponent } from './campaigns.component';
import { CampaignService } from '../../services/http-services/campaign.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { Campaign } from '../../shared/models/campaign.model';
import { TPipe } from '../../shared/i18n/t.pipe';

import { SsToastService } from '../../shared/ui/toast.service';
import { SsDialogService } from '../../shared/ui/dialog.service';

const campaign: Campaign = {
  _id: 'c-1',
  academy: 'aca-1',
  academyName: 'Padel House',
  facilities: ['f-1'],
  facilityNames: ['Padel Center'],
  goalType: 'bookings',
  goalTarget: 5,
  rewardTetri: 2000,
  maxCompletionsPerUser: 1,
  active: true,
  enrolledCount: 0,
  completedCount: 0,
};

describe('CampaignsComponent', () => {
  let component: CampaignsComponent;
  let fixture: ComponentFixture<CampaignsComponent>;
  let campaignSpy: jasmine.SpyObj<CampaignService>;
  let academySpy: jasmine.SpyObj<AcademyService>;
  let tenantSpy: jasmine.SpyObj<TenantService>;
  let dialogSpy: jasmine.SpyObj<SsDialogService>;
  let alertSpy: jasmine.SpyObj<SsToastService>;

  async function setup(superAdmin: boolean) {
    campaignSpy = jasmine.createSpyObj<CampaignService>('CampaignService', [
      'getCampaigns',
      'createCampaign',
      'updateCampaign',
      'deleteCampaign',
      'getParticipants',
    ]);
    campaignSpy.getCampaigns.and.returnValue(
      of({ data: [campaign], page: { page: 1, size: 20, total: 41 } }),
    );
    campaignSpy.updateCampaign.and.returnValue(of({ ...campaign, active: false }));
    campaignSpy.deleteCampaign.and.returnValue(of(undefined));

    academySpy = jasmine.createSpyObj<AcademyService>('AcademyService', ['getAllAcademies']);
    academySpy.getAllAcademies.and.returnValue(of([{ _id: 'aca-1', name: 'A1' } as never]));

    tenantSpy = jasmine.createSpyObj<TenantService>('TenantService', ['ensure', 'academyId']);
    tenantSpy.ensure.and.returnValue(of(null));
    tenantSpy.academyId.and.returnValue('aca-1');

    dialogSpy = jasmine.createSpyObj<SsDialogService>('SsDialogService', ['open']);
    alertSpy = jasmine.createSpyObj<SsToastService>('SsToastService', ['open']);
    alertSpy.open.and.returnValue(of(undefined));

    const routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        { provide: CampaignService, useValue: campaignSpy },
        { provide: AcademyService, useValue: academySpy },
        { provide: TenantService, useValue: tenantSpy },
        { provide: AuthService, useValue: { isSuperAdmin: () => superAdmin } },
        { provide: SsDialogService, useValue: dialogSpy },
        { provide: SsToastService, useValue: alertSpy },
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      // The override REPLACES the component's imports — the template uses the
      // `t` pipe, so TPipe has to come along or the view fails with NG0302.
      .overrideComponent(CampaignsComponent, {
        set: { imports: [TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CampaignsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  describe('as an academy admin', () => {
    beforeEach(async () => setup(false));

    it('loads page 1 without filters after the tenant resolves', () => {
      expect(component).toBeTruthy();
      expect(tenantSpy.ensure).toHaveBeenCalled();
      expect(campaignSpy.getCampaigns).toHaveBeenCalledTimes(1);
      expect(campaignSpy.getCampaigns.calls.mostRecent().args[0]).toEqual({
        page: 1,
        limit: 20,
        active: undefined,
        academyId: undefined,
      });
      // The academy select is superadmin-only, so no academy fetch here.
      expect(academySpy.getAllAcademies).not.toHaveBeenCalled();
      expect(component['rows']()).toEqual([campaign]);
      expect(component['total']()).toBe(41);
    });

    it('reloads immediately when the active chip changes', () => {
      component['setActiveFilter'](false);
      expect(campaignSpy.getCampaigns.calls.mostRecent().args[0].active).toBeFalse();
    });

    it('surfaces the error state and retries', () => {
      campaignSpy.getCampaigns.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );
      component['retry']();
      expect(component['hasError']()).toBeTrue();

      campaignSpy.getCampaigns.and.returnValue(of({ data: [campaign] }));
      component['retry']();
      expect(component['hasError']()).toBeFalse();
    });

    // ── the optimistic active switch ────────────────────────────────────────

    it('flips the row optimistically and keeps the server row on success', () => {
      component['onActiveToggle'](campaign, false);
      expect(campaignSpy.updateCampaign).toHaveBeenCalledWith('c-1', { active: false });
      expect(component['rows']()[0].active).toBeFalse();
    });

    it('reverts the row when the switch fails', () => {
      campaignSpy.updateCampaign.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );
      component['onActiveToggle'](campaign, false);
      expect(component['rows']()[0].active).toBeTrue();
      expect(alertSpy.open).toHaveBeenCalled();
    });

    // ── derived status + labels (docs/24 §5.1) ──────────────────────────────

    it('derives inactive → expired → scheduled → live in that order', () => {
      const past = '2020-01-01';
      const future = '2999-01-01';
      expect(component['derivedStatus']({ ...campaign, active: false })).toBe('inactive');
      // Inactive wins over everything, so the rest are tested on active rows.
      expect(component['derivedStatus']({ ...campaign, endsAt: past })).toBe('expired');
      expect(component['derivedStatus']({ ...campaign, startsAt: future })).toBe('scheduled');
      expect(component['derivedStatus'](campaign)).toBe('live');
    });

    it('counts a date-only endsAt to the END of that day', () => {
      // LOCAL date, not toISOString(): the component parses a date-only
      // endsAt as local end-of-day, and between 00:00 and 04:00 Tbilisi time
      // the UTC date is still "yesterday" — which made this test flake.
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      // "runs until today" must still read as live, not expired.
      expect(component['derivedStatus']({ ...campaign, endsAt: today })).toBe('live');
    });

    it('labels the goal in its own unit', () => {
      expect(component['goalLabel'](campaign)).toBe('5 ჯავშანი');
      expect(
        component['goalLabel']({ ...campaign, goalType: 'spend', goalTarget: 30000 }),
      ).toBe('300 ₾');
    });

    it('GENERATES the offer sentence — the row identity (no stored copy)', () => {
      expect(component['offerLabel'](campaign)).toBe(
        'ითამაშე 5-ჯერ და მიიღე 20 ₾',
      );
      expect(
        component['offerLabel']({ ...campaign, goalType: 'spend', goalTarget: 30000 }),
      ).toBe('დახარჯე 300 ₾ და მიიღე 20 ₾');
    });

    it('labels the reward in GEL with an optional validity hint', () => {
      expect(component['rewardLabel'](campaign)).toBe('20 ₾');
      expect(component['rewardHint'](campaign)).toBeNull();
      expect(component['rewardHint']({ ...campaign, rewardValidDays: 60 })).toContain('60');
    });

    it('names the scope: the venues, all venues, or the platform', () => {
      expect(component['scopeLabel'](campaign)).toBe('Padel Center');
      expect(component['scopeLabel']({ ...campaign, facilityNames: [] })).toBe('ყველა მოედანი');
      expect(
        component['scopeLabel']({ ...campaign, academy: null, facilityNames: [] }),
      ).toBe('პლატფორმა');
      expect(
        component['scopeLabel']({ ...campaign, facilityNames: ['A', 'B', 'C'] }),
      ).toBe('A +2');
    });

    it('reads an unbounded publication window as open-ended', () => {
      expect(component['periodLabel'](campaign)).toBe('უვადო');
      expect(
        component['periodLabel']({ ...campaign, startsAt: '2026-09-01', endsAt: '2026-09-30' }),
      ).toBe('01.09.26 – 30.09.26');
    });
  });

  describe('as a superadmin', () => {
    beforeEach(async () => setup(true));

    it('loads the academy list and passes the picked academy as a filter', () => {
      expect(academySpy.getAllAcademies).toHaveBeenCalled();
      component['onAcademyChange']('aca-2');
      expect(campaignSpy.getCampaigns.calls.mostRecent().args[0].academyId).toBe('aca-2');
    });
  });
});
