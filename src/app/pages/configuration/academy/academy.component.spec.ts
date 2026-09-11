import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { provideAnimations } from '@angular/platform-browser/animations';


import { AcademyComponent } from './academy.component';
import { AcademyService } from '../../../services/http-services/academy.service';
import { MediaService } from '../../../services/http-services/media.service';
import { TenantService } from '../../../shared/services/tenant.service';
import { Academy, AcademyStatus } from '../../../shared/models/academy.model';
import { SportType } from '../../../shared/enums/court-type.enum';
import { TPipe } from '../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../shared/ui/toast.service';
// ─── Test data ────────────────────────────────────────────────────────────────

const mockAcademy: Academy = {
  _id: 'academy-id-1',
  name: 'Sports Academy',
  admins: [],
  status: AcademyStatus.PUBLISHED,
  descriptionGeorgian: 'სპორტული აკადემია',
  descriptionEnglish: 'Sports Academy',
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AcademyComponent', () => {
  let component: AcademyComponent;
  let fixture: ComponentFixture<AcademyComponent>;
  let academyServiceSpy: jasmine.SpyObj<AcademyService>;
  let tenantServiceSpy: jasmine.SpyObj<TenantService>;
  let alertServiceSpy: jasmine.SpyObj<SsToastService>;
  let routerSpy: jasmine.SpyObj<Router>;

  function makeTenantSpy(academyData?: Academy) {
    const spy = jasmine.createSpyObj<TenantService>(
      'TenantService',
      ['resolveAcademy', 'ensure', 'clear'],
      {
        academyId: (() => (academyData ?? mockAcademy)._id ?? null) as any,
      },
    );
    // The component now initializes through ensure(); keep resolveAcademy stubbed
    // for backward compatibility with assertions that reference it.
    spy.resolveAcademy.and.returnValue(of(academyData ?? mockAcademy));
    spy.ensure.and.returnValue(of(academyData ?? mockAcademy));
    return spy;
  }

  async function createComponent(academyData?: Academy) {
    academyServiceSpy = jasmine.createSpyObj('AcademyService', [
      'getAcademyById',
      'updateAcademy',
    ]);
    tenantServiceSpy = makeTenantSpy(academyData);
    alertServiceSpy = jasmine.createSpyObj('SsToastService', ['open']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    alertServiceSpy.open.and.returnValue(of(undefined) as any);

    await TestBed.configureTestingModule({
      imports: [AcademyComponent],
      providers: [
        provideAnimations(),
        { provide: AcademyService, useValue: academyServiceSpy },
        { provide: MediaService, useValue: jasmine.createSpyObj('MediaService', ['upload']) },
        { provide: TenantService, useValue: tenantServiceSpy },
        { provide: SsToastService, useValue: alertServiceSpy },
        { provide: Router, useValue: routerSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(AcademyComponent, {
        set: { imports: [ReactiveFormsModule, TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AcademyComponent);
    component = fixture.componentInstance;
  }

  // ─── Component creation ──────────────────────────────────────────────────

  describe('component creation', () => {
    beforeEach(async () => {
      await createComponent();
    });

    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize the academyForm on creation', () => {
      // The form is built in ngOnInit, which only runs after the first detectChanges.
      fixture.detectChanges();
      expect(component.academyForm).toBeDefined();
    });
  });

  // ─── Form structure: flat field layout ───────────────────────────────────

  describe('form structure — flat field layout (no contactInfo nesting)', () => {
    beforeEach(async () => {
      await createComponent();
      fixture.detectChanges();
    });

    it('should initialize the form with a name control', () => {
      expect(component.academyForm.contains('name')).toBeTrue();
    });

    it('should NOT have a color control (facility colors removed)', () => {
      expect(component.academyForm.contains('color')).toBeFalse();
    });

    it('should initialize the form with a descriptionGeorgian control', () => {
      expect(component.academyForm.contains('descriptionGeorgian')).toBeTrue();
    });

    it('should initialize the form with a descriptionEnglish control', () => {
      expect(component.academyForm.contains('descriptionEnglish')).toBeTrue();
    });

    it('should NOT have a phone control (contact fields removed)', () => {
      expect(component.academyForm.contains('phone')).toBeFalse();
    });

    it('should NOT have an email control (contact fields removed)', () => {
      expect(component.academyForm.contains('email')).toBeFalse();
    });

    it('should NOT have an instagram control (contact fields removed)', () => {
      expect(component.academyForm.contains('instagram')).toBeFalse();
    });

    it('should NOT have a facebook control (contact fields removed)', () => {
      expect(component.academyForm.contains('facebook')).toBeFalse();
    });

    it('should NOT have a contactInfo nested form group (contact fields are now top-level)', () => {
      expect(component.academyForm.contains('contactInfo')).toBeFalse();
    });

    it('should NOT have a website control (removed)', () => {
      expect(component.academyForm.contains('website')).toBeFalse();
    });

    it('should NOT have a twitter control (removed)', () => {
      expect(component.academyForm.contains('twitter')).toBeFalse();
    });

    it('should NOT have a linkedIn control (removed)', () => {
      expect(component.academyForm.contains('linkedIn')).toBeFalse();
    });

    it('should NOT have an address control (removed)', () => {
      expect(component.academyForm.contains('address')).toBeFalse();
    });

    it('should NOT have a designPalette control (removed)', () => {
      expect(component.academyForm.contains('designPalette')).toBeFalse();
    });

    it('should NOT have a description control (replaced by descriptionGeorgian and descriptionEnglish)', () => {
      expect(component.academyForm.contains('description')).toBeFalse();
    });
  });

  // ─── Form initial state ───────────────────────────────────────────────────

  describe('form initial state (before academy loads)', () => {
    beforeEach(async () => {
      await createComponent();
      // Defer the academy load so the form keeps its initial (un-patched) values:
      // detectChanges runs ngOnInit (which builds academyForm) but the Subject never
      // emits, so loadAcademy's patchValue does not run.
      tenantServiceSpy.ensure.and.returnValue(new Subject<Academy>());
      fixture.detectChanges();
    });

    it('should start with name as an empty string', () => {
      expect(component.academyForm.get('name')!.value).toBe('');
    });

    it('should start with descriptionGeorgian as an empty string', () => {
      expect(component.academyForm.get('descriptionGeorgian')!.value).toBe('');
    });

    it('should start with descriptionEnglish as an empty string', () => {
      expect(component.academyForm.get('descriptionEnglish')!.value).toBe('');
    });
  });

  // ─── Form population after academy loads ─────────────────────────────────

  describe('form population after academy loads', () => {
    beforeEach(async () => {
      await createComponent(mockAcademy);
      fixture.detectChanges();
    });

    it('should patch the name field from the loaded academy', fakeAsync(() => {
      tick();
      expect(component.academyForm.get('name')!.value).toBe('Sports Academy');
    }));

    it('should patch descriptionGeorgian from the loaded academy', fakeAsync(() => {
      tick();
      expect(component.academyForm.get('descriptionGeorgian')!.value).toBe('სპორტული აკადემია');
    }));

    it('should patch descriptionEnglish from the loaded academy', fakeAsync(() => {
      tick();
      expect(component.academyForm.get('descriptionEnglish')!.value).toBe('Sports Academy');
    }));
  });

  // ─── name: required validation ────────────────────────────────────────────

  describe('name field validation', () => {
    beforeEach(async () => {
      await createComponent();
      fixture.detectChanges();
    });

    it('should mark name as invalid when it is empty', () => {
      const nameControl = component.academyForm.get('name')!;
      nameControl.setValue('');
      nameControl.markAsTouched();

      expect(nameControl.invalid).toBeTrue();
      expect(nameControl.errors?.['required']).toBeTruthy();
    });

    it('should mark name as valid when it has a non-empty value', () => {
      component.academyForm.get('name')!.setValue('My Academy');
      expect(component.academyForm.get('name')!.valid).toBeTrue();
    });
  });

  // ─── onSave: valid form ───────────────────────────────────────────────────

  describe('onSave — valid form', () => {
    beforeEach(async () => {
      await createComponent(mockAcademy);
      fixture.detectChanges();
    });

    it('should call academyService.updateAcademy when the form is valid', fakeAsync(() => {
      tick(); // let loadAcademy complete and patch the form
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));

      component.onSave();
      tick();

      expect(academyServiceSpy.updateAcademy).toHaveBeenCalled();
    }));

    it('should never send a color field (facility colors removed)', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));

      component.onSave();
      tick();

      const callArgs = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect('color' in callArgs).toBeFalse();
    }));

    it('should call updateAcademy with both description fields', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));
      component.academyForm.patchValue({
        descriptionGeorgian: 'განახლებული',
        descriptionEnglish: 'Updated',
      });

      component.onSave();
      tick();

      const callArgs = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect(callArgs.descriptionGeorgian).toBe('განახლებული');
      expect(callArgs.descriptionEnglish).toBe('Updated');
    }));

    it('should never send contact fields (phone/email/instagram/facebook removed)', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));

      component.onSave();
      tick();

      const callArgs = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect('phone' in callArgs).toBeFalse();
      expect('email' in callArgs).toBeFalse();
      expect('instagram' in callArgs).toBeFalse();
      expect('facebook' in callArgs).toBeFalse();
      expect((callArgs as any).contactInfo).toBeUndefined();
    }));

    it('should show success alert on successful save', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));

      component.onSave();
      tick();

      expect(alertServiceSpy.open).toHaveBeenCalledWith(
        'აკადემია წარმატებით შეინახა!',
        { appearance: 'success' },
      );
    }));

    it('should set isSaved to true after a successful save', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));

      component.onSave();
      tick();

      expect(component.isSaved()).toBeTrue();
    }));

    it('should set isSaving to false after a successful save', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));

      component.onSave();
      tick();

      expect(component.isSaving()).toBeFalse();
    }));
  });

  // ─── onSave: payload omits empty optional fields (BLOCKER 2) ──────────────
  //
  // The PUT used to send the raw form value: the placeholder logo
  // `{url:'',type:''}` failed nested validation → constant 400s. The payload
  // must omit empty-string optional fields and omit the logo unless a real
  // (non-empty url) logo exists.

  describe('onSave — payload omits empty optional fields', () => {
    // A pristine academy: only the required name set, everything else empty.
    const emptyAcademy: Academy = {
      _id: 'academy-id-1',
      name: 'Sports Academy',
      admins: [],
      status: AcademyStatus.PUBLISHED,
    };

    beforeEach(async () => {
      await createComponent(emptyAcademy);
      fixture.detectChanges();
    });

    it('omits the logo key entirely when no real logo exists (placeholder url)', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(emptyAcademy));
      // The form's logo group is the empty placeholder {url:'', type:''}.
      component.onSave();
      tick();

      const payload = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect('logo' in payload).toBeFalse();
    }));

    it('omits all blank optional text fields (descriptions)', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(emptyAcademy));

      component.onSave();
      tick();

      const payload = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect('descriptionGeorgian' in payload).toBeFalse();
      expect('descriptionEnglish' in payload).toBeFalse();
    }));

    it('includes filled optional fields and a real logo when present', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(emptyAcademy));
      component.academyForm.patchValue({
        descriptionGeorgian: 'აღწერა',
        logo: { url: 'https://cdn/logo.png', type: 'image/png', size: 1234, metadata: null },
      });

      component.onSave();
      tick();

      const payload = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect(payload.descriptionGeorgian).toBe('აღწერა');
      expect(payload.logo?.url).toBe('https://cdn/logo.png');
    }));

    it('sends logo: null when a previously stored logo was removed', fakeAsync(() => {
      // Removal must be EXPLICIT: omitting the field would silently keep the
      // old logo on the server (and never release its S3 objects).
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(emptyAcademy));
      component.academy.set({
        ...emptyAcademy,
        logo: { url: 'https://cdn/logo.png', type: 'image/png', size: 1234 },
      });
      component.academyForm.patchValue({
        logo: { url: 'https://cdn/logo.png', type: 'image/png', size: 1234, metadata: null },
      });

      component.removeLogo();
      component.onSave();
      tick();

      const payload = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect('logo' in payload).toBeTrue();
      expect(payload.logo).toBeNull();
    }));
  });

  // ─── onSave: invalid form ─────────────────────────────────────────────────

  describe('onSave — invalid form', () => {
    beforeEach(async () => {
      await createComponent();
      fixture.detectChanges();
    });

    it('should not call updateAcademy when the form is invalid (name empty)', fakeAsync(() => {
      tick();
      component.academyForm.get('name')!.setValue('');

      component.onSave();

      expect(academyServiceSpy.updateAcademy).not.toHaveBeenCalled();
    }));

    it('should show an error alert when the form is invalid', fakeAsync(() => {
      tick();
      component.academyForm.get('name')!.setValue('');

      component.onSave();
      tick();

      expect(alertServiceSpy.open).toHaveBeenCalledWith(
        'გთხოვთ შეავსოთ ყველა სავალდებულო ველი',
        { appearance: 'error' },
      );
    }));
  });

  // ─── onSave: missing tenant academyId ─────────────────────────────────────

  describe('onSave — missing academyId (unresolved tenant)', () => {
    beforeEach(async () => {
      await createComponent(mockAcademy);
      // Tenant resolved but with no academy id (e.g. operator without an academy).
      Object.defineProperty(tenantServiceSpy, 'academyId', {
        value: () => null,
        writable: true,
        configurable: true,
      });
      fixture.detectChanges();
    });

    it('should NOT call updateAcademy when the academy id is missing', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));

      component.onSave();
      tick();

      expect(academyServiceSpy.updateAcademy).not.toHaveBeenCalled();
    }));

    it('should show a Georgian error alert when the academy id is missing', fakeAsync(() => {
      tick();

      component.onSave();
      tick();

      expect(alertServiceSpy.open).toHaveBeenCalledWith('აკადემია ვერ მოიძებნა', {
        appearance: 'error',
      });
    }));
  });

  // ─── onSave: error path ───────────────────────────────────────────────────

  describe('onSave — service error', () => {
    beforeEach(async () => {
      await createComponent(mockAcademy);
      fixture.detectChanges();
    });

    it('should show an error alert when updateAcademy fails', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(throwError(() => new Error('server error')));

      component.onSave();
      tick();

      expect(alertServiceSpy.open).toHaveBeenCalledWith(
        'შეცდომა აკადემიის შენახვისას',
        { appearance: 'error' },
      );
    }));

    it('should set isSaving to false after an update error', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(throwError(() => new Error('error')));

      component.onSave();
      tick();

      expect(component.isSaving()).toBeFalse();
    }));
  });

  // ─── Academy load ─────────────────────────────────────────────────────────

  describe('academy loading on init', () => {
    it('should resolve the tenant academy on init', fakeAsync(async () => {
      await createComponent();
      fixture.detectChanges();
      tick();

      expect(tenantServiceSpy.ensure).toHaveBeenCalled();
    }));

    it('should set isLoading to false after a successful load', fakeAsync(async () => {
      await createComponent(mockAcademy);
      fixture.detectChanges();
      tick();

      expect(component.isLoading()).toBeFalse();
    }));

    it('should set isLoading to false even when loading fails', fakeAsync(async () => {
      await createComponent();
      tenantServiceSpy.ensure.and.returnValue(throwError(() => new Error('load error')));

      fixture.detectChanges();
      tick();

      expect(component.isLoading()).toBeFalse();
    }));

    it('should show an error alert when loading fails', fakeAsync(async () => {
      await createComponent();
      tenantServiceSpy.ensure.and.returnValue(throwError(() => new Error('load error')));

      fixture.detectChanges();
      tick();

      expect(alertServiceSpy.open).toHaveBeenCalledWith(
        'შეცდომა აკადემიის ჩატვირთვისას',
        { appearance: 'error' },
      );
    }));
  });

  // ─── navigateToFacilities ────────────────────────────────────────────────

  describe('navigateToFacilities', () => {
    beforeEach(async () => {
      await createComponent();
    });

    it('should navigate to /configuration/facilities', () => {
      component.navigateToFacilities();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/configuration/facilities']);
    });
  });

  // ─── logoUrl getter ───────────────────────────────────────────────────────

  describe('logoUrl getter', () => {
    beforeEach(async () => {
      await createComponent();
      fixture.detectChanges();
    });

    it('should return an empty string when logo url is not set', () => {
      expect(component.logoUrl).toBe('');
    });

    it('should return the logo url when it is set', () => {
      component.academyForm.patchValue({ logo: { url: 'data:image/png;base64,abc', type: '', size: 0, metadata: null } });
      expect(component.logoUrl).toBe('data:image/png;base64,abc');
    });
  });

  // ─── removeLogo ───────────────────────────────────────────────────────────

  describe('removeLogo', () => {
    beforeEach(async () => {
      await createComponent(mockAcademy);
      fixture.detectChanges();
    });

    it('should clear the logo url when removeLogo is called', fakeAsync(() => {
      tick();
      component.academyForm.patchValue({ logo: { url: 'data:image/png;base64,abc', type: 'image/png', size: 100, metadata: null } });

      component.removeLogo();

      expect(component.academyForm.get('logo.url')!.value).toBe('');
    }));

    it('should mark the form as dirty when removeLogo is called', fakeAsync(() => {
      tick();
      component.removeLogo();
      expect(component.academyForm.dirty).toBeTrue();
    }));
  });

  // ─── Padel equipment rules (docs/20) ─────────────────────────────────────

  describe('padel equipment rules section', () => {
    const academyWithRule: Academy = {
      ...mockAcademy,
      sportRules: [
        {
          sportType: SportType.Padel,
          racketsIncluded: 2,
          racketRentTetri: 550,
          ballsPriceTetri: 800,
        },
      ],
    };

    it('omits sportRules from the payload when no rule exists and the section is untouched', fakeAsync(async () => {
      await createComponent(mockAcademy); // no sportRules on the academy
      fixture.detectChanges();
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));

      component.onSave();
      tick();

      const payload = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect('sportRules' in payload).toBeFalse();
    }));

    it('patches the section from a loaded rule (tetri → GEL)', fakeAsync(async () => {
      await createComponent(academyWithRule);
      fixture.detectChanges();
      tick();

      const group = component.academyForm.get('padelRules')!.value;
      expect(group.racketsIncluded).toBe(2);
      expect(group.racketRentGel).toBe(5.5);
      expect(group.ballsPriceGel).toBe(8);
    }));

    it('sends the padel rule with GEL converted to integer tetri', fakeAsync(async () => {
      await createComponent(mockAcademy);
      fixture.detectChanges();
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));
      component.academyForm.get('padelRules')!.patchValue({
        racketsIncluded: 1,
        racketRentGel: 5.5,
        ballsPriceGel: 8,
      });

      component.onSave();
      tick();

      const payload = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect(payload.sportRules).toEqual([
        {
          sportType: SportType.Padel,
          racketsIncluded: 1,
          racketRentTetri: 550,
          ballsPriceTetri: 800,
        },
      ]);
    }));

    it('drops empty price fields (offer does not exist) but keeps the rule', fakeAsync(async () => {
      await createComponent(academyWithRule);
      fixture.detectChanges();
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(academyWithRule));
      component.academyForm.get('padelRules')!.patchValue({
        racketRentGel: null,
        ballsPriceGel: null,
      });

      component.onSave();
      tick();

      const payload = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect(payload.sportRules).toEqual([
        { sportType: SportType.Padel, racketsIncluded: 2 },
      ]);
    }));

    it('still sends an existing rule even when the section is left untouched', fakeAsync(async () => {
      await createComponent(academyWithRule);
      fixture.detectChanges();
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(academyWithRule));

      component.onSave();
      tick();

      const payload = academyServiceSpy.updateAcademy.calls.mostRecent().args[1];
      expect(payload.sportRules?.[0].racketsIncluded).toBe(2);
    }));

    it('blocks saving when racketsIncluded is outside 0..4', fakeAsync(async () => {
      await createComponent(mockAcademy);
      fixture.detectChanges();
      tick();
      component.academyForm.get('padelRules.racketsIncluded')!.setValue(5);

      component.onSave();
      tick();

      expect(academyServiceSpy.updateAcademy).not.toHaveBeenCalled();
      expect(alertServiceSpy.open).toHaveBeenCalledWith(
        'გთხოვთ შეავსოთ ყველა სავალდებულო ველი',
        { appearance: 'error' },
      );
    }));
  });

  // ─── isSaved resets on form change ───────────────────────────────────────

  describe('isSaved resets when form changes', () => {
    beforeEach(async () => {
      await createComponent(mockAcademy);
      fixture.detectChanges();
    });

    it('should set isSaved to false when the form is dirtied after a successful save', fakeAsync(() => {
      tick();
      academyServiceSpy.updateAcademy.and.returnValue(of(mockAcademy));

      // Save first to set isSaved = true
      component.onSave();
      tick();
      expect(component.isSaved()).toBeTrue();

      // Now dirty the form
      component.academyForm.get('name')!.setValue('Changed Name');
      component.academyForm.markAsDirty();
      component.academyForm.updateValueAndValidity();
      tick();

      expect(component.isSaved()).toBeFalse();
    }));
  });
});
