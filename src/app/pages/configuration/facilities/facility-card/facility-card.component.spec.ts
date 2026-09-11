import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { FacilityCardComponent } from './facility-card.component';
import { FacilityService } from '../../../../services/http-services/facility.service';
import { Facility } from '../../../../shared/models/facility.model';
import { TPipe } from '../../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../../shared/ui/toast.service';
import { SsDialogService } from '../../../../shared/ui/dialog.service';
const facility: Facility = {
  _id: 'fac-1',
  name: 'Padel House',
  country: 'Georgia',
  city: 'Tbilisi',
  description: 'desc',
  amenities: [],
  activeState: false,
};

describe('FacilityCardComponent', () => {
  let component: FacilityCardComponent;
  let fixture: ComponentFixture<FacilityCardComponent>;
  let facilitySpy: jasmine.SpyObj<FacilityService>;
  let dialogStub: { open: jasmine.Spy };

  async function setup() {
    facilitySpy = jasmine.createSpyObj<FacilityService>('FacilityService', ['setFacilityStatus']);
    // Auto-confirm by default; individual tests flip it to exercise declines.
    dialogStub = { open: jasmine.createSpy('open').and.returnValue(of(true)) };

    await TestBed.configureTestingModule({
      imports: [FacilityCardComponent],
      providers: [
        { provide: FacilityService, useValue: facilitySpy },
        { provide: SsToastService, useValue: { open: () => of(undefined) } },
        { provide: SsDialogService, useValue: dialogStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(FacilityCardComponent, {
        set: { imports: [TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FacilityCardComponent);
    component = fixture.componentInstance;
    component.facility = { ...facility };
    component.ngOnChanges();
    fixture.detectChanges();
  }

  beforeEach(async () => setup());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('confirmed publish toggle calls PATCH /facilities/:id/status via setFacilityStatus', () => {
    facilitySpy.setFacilityStatus.and.returnValue(of({ ...facility, activeState: true }));

    component.onToggleState(true);

    expect(dialogStub.open).toHaveBeenCalled();
    expect(facilitySpy.setFacilityStatus).toHaveBeenCalledWith('fac-1', true);
    expect(component.activeState()).toBeTrue();
  });

  it('declined publish toggle reverts the switch and never PATCHes', () => {
    dialogStub.open.and.returnValue(of(false));

    component.onToggleState(true);

    expect(facilitySpy.setFacilityStatus).not.toHaveBeenCalled();
    expect(component.activeState()).toBeFalse();
  });

  it('dismissed confirm (no emission) also reverts the switch', () => {
    dialogStub.open.and.returnValue(of());

    component.onToggleState(true);

    expect(facilitySpy.setFacilityStatus).not.toHaveBeenCalled();
    expect(component.activeState()).toBeFalse();
  });

  it('emits the updated facility on success', () => {
    const updated = { ...facility, activeState: true };
    facilitySpy.setFacilityStatus.and.returnValue(of(updated));
    const emitted = spyOn(component.facilityUpdated, 'emit');

    component.onToggleState(true);

    expect(emitted).toHaveBeenCalledWith(updated);
  });

  it('reverts the optimistic toggle when the PATCH fails', () => {
    facilitySpy.setFacilityStatus.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500 })),
    );

    component.onToggleState(true);

    expect(component.activeState()).toBeFalse();
  });
});
