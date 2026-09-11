import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { VouchersComponent } from './vouchers.component';
import { TPipe } from '../../shared/i18n/t.pipe';
import { VoucherService } from '../../services/http-services/voucher.service';
import { FacilityService } from '../../services/http-services/facility.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { Academy } from '../../shared/models/academy.model';
import { Facility } from '../../shared/models/facility.model';
import { PendingGrant, Voucher } from '../../shared/models/voucher.model';

import { SsToastService } from '../../shared/ui/toast.service';
const facility: Facility = {
  _id: 'fac-1',
  name: 'Padel House',
  country: 'Georgia',
  city: 'Tbilisi',
  description: 'desc',
  amenities: [],
};

const academy = { _id: 'aca-9', name: 'Academy Nine' } as Academy;

const activeVoucher: Voucher = {
  _id: 'v-1',
  facility: 'fac-1',
  code: 'SS-ABCD-2345',
  initialTetri: 5000,
  balanceTetri: 5000,
  currency: 'GEL',
  status: 'active',
  source: 'admin_grant',
  ownerPhone: '+995555123456',
};

const pendingGrant: PendingGrant = {
  _id: 'g-1',
  phone: '+995555999888',
  facility: 'fac-1',
  amountTetri: 3000,
  source: 'admin_grant',
  note: 'welcome',
};

describe('VouchersComponent', () => {
  let component: VouchersComponent;
  let fixture: ComponentFixture<VouchersComponent>;
  let voucherSpy: jasmine.SpyObj<VoucherService>;
  let facilitySpy: jasmine.SpyObj<FacilityService>;
  let academySpy: jasmine.SpyObj<AcademyService>;
  let tenantSpy: jasmine.SpyObj<TenantService>;
  let alertSpy: jasmine.SpyObj<SsToastService>;
  let superAdmin = false;

  async function setup() {
    voucherSpy = jasmine.createSpyObj<VoucherService>('VoucherService', [
      'grant',
      'import',
      'getVouchers',
      'getGrants',
    ]);
    facilitySpy = jasmine.createSpyObj<FacilityService>('FacilityService', [
      'getFacilitiesByAcademy',
    ]);
    academySpy = jasmine.createSpyObj<AcademyService>('AcademyService', ['getAllAcademies']);
    tenantSpy = jasmine.createSpyObj<TenantService>('TenantService', ['academyId', 'ensure']);
    alertSpy = jasmine.createSpyObj<SsToastService>('SsToastService', ['open']);

    tenantSpy.academyId.and.returnValue('aca-1');
    tenantSpy.ensure.and.returnValue(of(null));
    facilitySpy.getFacilitiesByAcademy.and.returnValue(of([facility]));
    academySpy.getAllAcademies.and.returnValue(of([academy]));
    voucherSpy.getVouchers.and.returnValue(
      of({ data: [activeVoucher], page: { page: 1, size: 20, total: 1 } }),
    );
    voucherSpy.getGrants.and.returnValue(
      of({ data: [pendingGrant], page: { page: 1, size: 20, total: 1 } }),
    );
    voucherSpy.grant.and.returnValue(of({ status: 'granted', voucher: activeVoucher }));
    voucherSpy.import.and.returnValue(of({ granted: 1, pending: 1 }));
    alertSpy.open.and.returnValue(of(undefined));

    const routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [VouchersComponent],
      providers: [
        { provide: VoucherService, useValue: voucherSpy },
        { provide: FacilityService, useValue: facilitySpy },
        { provide: AcademyService, useValue: academySpy },
        { provide: AuthService, useValue: { isSuperAdmin: () => superAdmin } },
        { provide: TenantService, useValue: tenantSpy },
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: SsToastService, useValue: alertSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(VouchersComponent, {
        // The template translates through the impure `t` pipe — an override that
        // replaces `imports` must keep it or the view fails with NG0302.
        set: { imports: [TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(VouchersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  describe('as admin', () => {
    beforeEach(async () => {
      superAdmin = false;
      await setup();
    });

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    // ── scope resolution ───────────────────────────────────────────────────────
    it('resolves the tenant, auto-selects the single facility and loads both lists', () => {
      expect(facilitySpy.getFacilitiesByAcademy).toHaveBeenCalledWith('aca-1');
      expect(component.selectedScope()).toEqual({ kind: 'facility', facilityId: 'fac-1' });
      expect(voucherSpy.getVouchers).toHaveBeenCalledWith({ facilityId: 'fac-1' }, 1, 20);
      expect(voucherSpy.getGrants).toHaveBeenCalledWith({ facilityId: 'fac-1' }, 1, 20);
      expect(component.vouchers()).toEqual([activeVoucher]);
      expect(component.grants()).toEqual([pendingGrant]);
    });

    it('the whole-academy chip switches to the academy-WIDE scope', () => {
      voucherSpy.getVouchers.calls.reset();
      component.onAcademyChipClick();
      expect(component.selectedScope()).toEqual({ kind: 'academy', academyId: 'aca-1' });
      expect(voucherSpy.getVouchers).toHaveBeenCalledWith({ academyId: 'aca-1' }, 1, 20);
    });

    it('pages the voucher list independently of the grants list', () => {
      voucherSpy.getVouchers.calls.reset();
      voucherSpy.getGrants.calls.reset();
      component.onVouchersPageChange(2);
      expect(voucherSpy.getVouchers).toHaveBeenCalledWith({ facilityId: 'fac-1' }, 2, 20);
      // The grants list keeps its own page.
      expect(voucherSpy.getGrants).toHaveBeenCalledWith({ facilityId: 'fac-1' }, 1, 20);
    });

    it('falls back to the academy scope when the tenant has no facilities', fakeAsync(() => {
      facilitySpy.getFacilitiesByAcademy.and.returnValue(of([]));
      component.ngOnInit();
      tick();
      expect(component.selectedScope()).toEqual({ kind: 'academy', academyId: 'aca-1' });
    }));

    it('does not load facilities when there is no tenant academy', fakeAsync(() => {
      tenantSpy.academyId.and.returnValue(null);
      facilitySpy.getFacilitiesByAcademy.calls.reset();
      component.ngOnInit();
      tick();
      expect(facilitySpy.getFacilitiesByAcademy).not.toHaveBeenCalled();
      expect(component.facilities()).toEqual([]);
    }));

    it('surfaces an error state when a list fetch hard-fails', () => {
      voucherSpy.getVouchers.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );
      voucherSpy.getGrants.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );
      // Re-run the resolution chain to trigger a fresh loadLists().
      component.ngOnInit();
      expect(component.hasError()).toBeTrue();
    });

    // ── grant submit ───────────────────────────────────────────────────────────
    it('submitGrant normalizes the phone, converts GEL to tetri and POSTs (success alert)', () => {
      component.grantForm.patchValue({ phone: '+995 555 123 456', amountGel: 50, note: '  hi  ' });
      component.submitGrant();

      expect(voucherSpy.grant).toHaveBeenCalledWith({
        phone: '+995555123456',
        facilityId: 'fac-1',
        amountTetri: 5000,
        note: 'hi',
      });
      expect(alertSpy.open).toHaveBeenCalledWith(
        'მიენიჭა',
        jasmine.objectContaining({ appearance: 'success' }),
      );
      // The form is reset after a successful grant, and the lists refresh.
      expect(component.grantForm.value.phone).toBeFalsy();
      expect(voucherSpy.getVouchers).toHaveBeenCalledTimes(2);
    });

    it('submitGrant carries the academy scope when the academy chip is active', () => {
      component.onAcademyChipClick();
      component.grantForm.patchValue({ phone: '+995555123456', amountGel: 30 });
      component.submitGrant();
      expect(voucherSpy.grant).toHaveBeenCalledWith(
        jasmine.objectContaining({ academyId: 'aca-1', amountTetri: 3000 }),
      );
      expect(voucherSpy.grant).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ facilityId: jasmine.anything() }),
      );
    });

    it('submitGrant shows an info alert when the API returns a pending grant', () => {
      voucherSpy.grant.and.returnValue(of({ status: 'pending', grant: pendingGrant }));
      component.grantForm.patchValue({ phone: '+995555999888', amountGel: 30 });
      component.submitGrant();

      expect(voucherSpy.grant).toHaveBeenCalledWith(
        jasmine.objectContaining({ phone: '+995555999888', amountTetri: 3000 }),
      );
      expect(alertSpy.open).toHaveBeenCalledWith(
        'მოლოდინში დაემატა',
        jasmine.objectContaining({ appearance: 'info' }),
      );
    });

    it('submitGrant does nothing when the form is invalid', () => {
      component.grantForm.patchValue({ phone: 'not-a-phone', amountGel: 0 });
      component.submitGrant();
      expect(voucherSpy.grant).not.toHaveBeenCalled();
    });

    // ── import parsing ─────────────────────────────────────────────────────────
    it('parseImport accepts valid lines (amounts in tetri) and skips blanks', () => {
      const { entries, errors } = component.parseImport(
        '+995555123456,50\n\n  995 555 123 457 , 12.5 \n',
      );
      expect(errors).toEqual([]);
      expect(entries).toEqual([
        { phone: '+995555123456', amountTetri: 5000 },
        { phone: '995555123457', amountTetri: 1250 },
      ]);
    });

    it('parseImport reports a per-line error for each bad line', () => {
      const text = ['+995555123456,10', 'bad-phone,10', '+995555123457,-5', 'too,many,fields'].join(
        '\n',
      );
      const { entries, errors } = component.parseImport(text);
      expect(entries).toEqual([{ phone: '+995555123456', amountTetri: 1000 }]);
      expect(errors.length).toBe(3);
      expect(errors[0]).toContain('ხაზი 2');
      expect(errors[1]).toContain('ხაზი 3');
      expect(errors[2]).toContain('ხაზი 4');
    });

    it('submitImport blocks on parse errors and does not call the API', () => {
      component.importControl.setValue('bad-phone,10');
      component.submitImport();
      expect(component.importErrors().length).toBe(1);
      expect(voucherSpy.import).not.toHaveBeenCalled();
    });

    it('submitImport posts valid entries with the selected scope and reports the split', () => {
      component.importControl.setValue('+995555123456,50\n+995555123457,25');
      component.submitImport();

      expect(voucherSpy.import).toHaveBeenCalledWith(
        { facilityId: 'fac-1' },
        [
          { phone: '+995555123456', amountTetri: 5000 },
          { phone: '+995555123457', amountTetri: 2500 },
        ],
        undefined,
      );
      expect(alertSpy.open).toHaveBeenCalledWith(
        'მიენიჭა 1 · მოლოდინში 1',
        jasmine.objectContaining({ appearance: 'success' }),
      );
      expect(component.importErrors()).toEqual([]);
    });

    it('submitImport flags an empty list', () => {
      component.importControl.setValue('   \n  ');
      component.submitImport();
      expect(component.importErrors().length).toBe(1);
      expect(voucherSpy.import).not.toHaveBeenCalled();
    });

    // ── derived status chips ───────────────────────────────────────────────────
    it('derivedStatus: pending_activation wins over everything', () => {
      const v: Voucher = { ...activeVoucher, status: 'pending_activation', balanceTetri: 0 };
      expect(component.derivedStatus(v)).toBe('pending_activation');
    });

    it('derivedStatus: a zero balance is depleted', () => {
      expect(component.derivedStatus({ ...activeVoucher, balanceTetri: 0 })).toBe('depleted');
    });

    it('derivedStatus: a past expiry with balance left is expired', () => {
      expect(component.derivedStatus({ ...activeVoucher, expiresAt: '2020-01-01' })).toBe('expired');
    });

    it('derivedStatus: an active, funded, unexpired voucher is active', () => {
      expect(component.derivedStatus({ ...activeVoucher, expiresAt: '2999-01-01' })).toBe('active');
    });

    it('statusBadgeClass maps each state to its ss-badge modifier', () => {
      expect(component.statusBadgeClass('active')).toBe('ss-badge ss-badge--positive');
      expect(component.statusBadgeClass('depleted')).toBe('ss-badge ss-badge--neutral');
      expect(component.statusBadgeClass('expired')).toBe('ss-badge ss-badge--negative');
      expect(component.statusBadgeClass('pending_activation')).toBe('ss-badge ss-badge--warning');
    });

    it('renders the voucher and grant tables from the loaded lists', () => {
      const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(html).toContain('SS-ABCD-2345');
      expect(html).toContain('+995555123456');
      expect(html).toContain('+995555999888');
      // balance/initial rendered in GEL
      expect(html).toContain('50');
    });

    it('ownerLabel and money helpers convert tetri to GEL', () => {
      expect(component.balanceGel(activeVoucher)).toBe(50);
      expect(component.initialGel(activeVoucher)).toBe(50);
      expect(component.grantAmountGel(pendingGrant)).toBe(30);
      expect(component.ownerLabel(activeVoucher)).toBe('+995555123456');
      expect(component.ownerLabel({ ...activeVoucher, ownerMemberId: 42 })).toBe(
        '000042 · +995555123456',
      );
      expect(component.expiryLabel(null)).toBe('—');
      expect(component.expiryLabel('2026-12-31T00:00:00Z')).toBe('2026-12-31');
    });
  });

  describe('as superadmin', () => {
    beforeEach(async () => {
      superAdmin = true;
      await setup();
    });

    it('defaults to the UNIVERSAL pool and loads the academy select', () => {
      expect(academySpy.getAllAcademies).toHaveBeenCalled();
      expect(component.selectedScope()).toEqual({ kind: 'universal' });
      expect(voucherSpy.getVouchers).toHaveBeenCalledWith({}, 1, 20);
      expect(facilitySpy.getFacilitiesByAcademy).not.toHaveBeenCalled();
    });

    it('picking an academy loads its facilities and selects the academy-wide scope', () => {
      voucherSpy.getVouchers.calls.reset();
      component.onAcademyChange('aca-9');
      expect(facilitySpy.getFacilitiesByAcademy).toHaveBeenCalledWith('aca-9');
      expect(component.selectedScope()).toEqual({ kind: 'academy', academyId: 'aca-9' });
      expect(voucherSpy.getVouchers).toHaveBeenCalledWith({ academyId: 'aca-9' }, 1, 20);
    });

    it('clearing the academy select returns to the universal pool', () => {
      component.onAcademyChange('aca-9');
      voucherSpy.getVouchers.calls.reset();
      component.onAcademyChange('');
      expect(component.selectedScope()).toEqual({ kind: 'universal' });
      expect(component.facilities()).toEqual([]);
      expect(voucherSpy.getVouchers).toHaveBeenCalledWith({}, 1, 20);
    });

    it('a universal grant posts NEITHER facilityId nor academyId', () => {
      component.grantForm.patchValue({ phone: '+995555123456', amountGel: 50 });
      component.submitGrant();
      const dto = voucherSpy.grant.calls.mostRecent().args[0];
      expect(dto.facilityId).toBeUndefined();
      expect(dto.academyId).toBeUndefined();
      expect(dto.amountTetri).toBe(5000);
    });
  });
});
