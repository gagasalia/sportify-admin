import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { FacilityNamesService } from './facility-names.service';
import { LANG_STORAGE_KEY, switchLang } from './lang';
import { FacilityService } from '../../services/http-services/facility.service';
import { Facility } from '../models/facility.model';
import { TenantService } from '../services/tenant.service';

describe('FacilityNamesService', () => {
  let facilitySpy: jasmine.SpyObj<FacilityService>;
  let tenantSpy: { ensure: jasmine.Spy };

  function build(): FacilityNamesService {
    facilitySpy = jasmine.createSpyObj<FacilityService>('FacilityService', [
      'getFacilitiesByAcademy',
    ]);
    facilitySpy.getFacilitiesByAcademy.and.returnValue(
      of([{ _id: 'f1', name: 'ვაკის პადელი', nameEn: 'Vake Padel' } as Facility]),
    );
    tenantSpy = { ensure: jasmine.createSpy('ensure').and.returnValue(of({ _id: 'aca-1' })) };

    TestBed.configureTestingModule({
      providers: [
        { provide: FacilityService, useValue: facilitySpy },
        { provide: TenantService, useValue: tenantSpy },
      ],
    });
    return TestBed.inject(FacilityNamesService);
  }

  afterEach(() => {
    switchLang('ka');
    localStorage.removeItem(LANG_STORAGE_KEY);
  });

  it('resolves a Georgian snapshot to the English name in an English session', () => {
    const service = build();
    service.ensure();

    switchLang('ka');
    expect(service.label('f1', 'ვაკის პადელი')).toBe('ვაკის პადელი');
    switchLang('en');
    expect(service.label('f1', 'ვაკის პადელი')).toBe('Vake Padel');
  });

  // Rows survive their facility (deleted venues, other academies) — the frozen
  // snapshot is the only thing left to show, so it must not be dropped.
  it('falls back to the row snapshot for an unknown facility', () => {
    const service = build();
    service.ensure();

    switchLang('en');
    expect(service.label('gone', 'ძველი ობიექტი')).toBe('ძველი ობიექტი');
    expect(service.label(undefined, 'ძველი ობიექტი')).toBe('ძველი ობიექტი');
  });

  it('loads each academy once', () => {
    const service = build();
    service.ensureFor('aca-1');
    service.ensureFor('aca-1');
    service.ensureFor('aca-2');

    expect(facilitySpy.getFacilitiesByAcademy).toHaveBeenCalledTimes(2);
  });

  // A failed load must leave the door open: the next page visit retries rather
  // than showing Georgian names for the rest of the session.
  it('retries after a failed load', () => {
    const service = build();
    facilitySpy.getFacilitiesByAcademy.and.returnValue(throwError(() => new Error('boom')));

    service.ensureFor('aca-1');
    service.ensureFor('aca-1');

    expect(facilitySpy.getFacilitiesByAcademy).toHaveBeenCalledTimes(2);
  });
});
