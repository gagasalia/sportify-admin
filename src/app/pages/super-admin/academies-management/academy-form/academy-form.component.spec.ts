import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { provideAnimations } from '@angular/platform-browser/animations';


import { AcademyFormComponent } from './academy-form.component';
import { AcademyService } from '../../../../services/http-services/academy.service';
import { UserManagementService } from '../../../../services/http-services/user-management.service';
import { Academy, AcademyStatus } from '../../../../shared/models/academy.model';
import { User, UserType } from '../../../../shared/models/user.model';
import { TPipe } from '../../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../../shared/ui/toast.service';
import { SS_DIALOG_CONTEXT } from '../../../../shared/ui/dialog.service';
// ─── Test data ────────────────────────────────────────────────────────────────

const mockAdminUser: User = {
  _id: 'admin-id-1',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'One',
  userType: [UserType.ADMIN],
  phone: '5551111',
};

const mockSuperAdminUser: User = {
  _id: 'superadmin-id-1',
  email: 'super@example.com',
  firstName: 'Super',
  lastName: 'Admin',
  userType: [UserType.SUPERADMIN],
  phone: '5552222',
};

const mockAdminUsers: User[] = [mockAdminUser, mockSuperAdminUser];

const mockExistingAcademy: Academy = {
  _id: 'academy-id-1',
  name: 'Existing Academy',
  admins: [mockAdminUser],
  status: AcademyStatus.PUBLISHED,
};

const mockSavedAcademy: Academy = {
  _id: 'academy-id-2',
  name: 'New Academy',
  admins: ['admin-id-1'],
  status: AcademyStatus.UNPUBLISHED,
};

// ─── Context factory ──────────────────────────────────────────────────────────

function makeContext(academy?: Academy) {
  return {
    data: academy ? { academy } : {},
    completeWith: jasmine.createSpy('completeWith'),
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AcademyFormComponent', () => {
  let component: AcademyFormComponent;
  let fixture: ComponentFixture<AcademyFormComponent>;
  let academyServiceSpy: jasmine.SpyObj<AcademyService>;
  let userServiceSpy: jasmine.SpyObj<UserManagementService>;
  let alertServiceSpy: jasmine.SpyObj<SsToastService>;
  let contextSpy: ReturnType<typeof makeContext>;

  // Helper: create and compile the TestBed with the given context
  async function createComponent(academy?: Academy) {
    contextSpy = makeContext(academy);

    academyServiceSpy = jasmine.createSpyObj('AcademyService', [
      'createAcademy',
      'updateAcademy',
    ]);
    userServiceSpy = jasmine.createSpyObj('UserManagementService', ['findAllUsers']);
    alertServiceSpy = jasmine.createSpyObj('SsToastService', ['open']);

    // Defaults
    userServiceSpy.findAllUsers.and.returnValue(of({ data: mockAdminUsers }) as any);
    alertServiceSpy.open.and.returnValue(of(undefined) as any);

    await TestBed.configureTestingModule({
      imports: [AcademyFormComponent],
      providers: [
        provideAnimations(),
        { provide: SS_DIALOG_CONTEXT, useValue: contextSpy },
        { provide: AcademyService, useValue: academyServiceSpy },
        { provide: UserManagementService, useValue: userServiceSpy },
        { provide: SsToastService, useValue: alertServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(AcademyFormComponent, {
        set: { imports: [ReactiveFormsModule, TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AcademyFormComponent);
    component = fixture.componentInstance;
  }

  // ─── Shared: creation mode setup ──────────────────────────────────────────

  describe('create mode (no existing academy)', () => {
    beforeEach(async () => {
      await createComponent(); // no academy → create mode
    });

    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize form with name and admins controls (no status in create mode)', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(component.academyForm.contains('name')).toBeTrue();
      expect(component.academyForm.contains('admins')).toBeTrue();
      expect(component.academyForm.contains('status')).toBeFalse();
    }));

    it('should require the name field', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      const nameControl = component.academyForm.get('name')!;
      nameControl.setValue('');
      nameControl.markAsTouched();

      expect(nameControl.invalid).toBeTrue();
      expect(nameControl.errors?.['required']).toBeTruthy();
    }));

    it('should mark name as valid when it has a value', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      component.academyForm.get('name')!.setValue('My Academy');

      expect(component.academyForm.get('name')!.valid).toBeTrue();
    }));

    it('should require at least one admin (arrayRequiredValidator)', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      const adminsControl = component.academyForm.get('admins')!;
      adminsControl.setValue([]);

      expect(adminsControl.invalid).toBeTrue();
      expect(adminsControl.errors?.['required']).toBeTruthy();
    }));

    it('should consider admins valid when at least one user is selected', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      component.academyForm.get('admins')!.setValue([mockAdminUser]);

      expect(component.academyForm.get('admins')!.valid).toBeTrue();
    }));

    it('should not register a status control in create mode', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(component.academyForm.contains('status')).toBeFalse();
      expect(component.academyForm.get('status')).toBeNull();
    }));

    it('should default the name to an empty string in create mode', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(component.academyForm.get('name')!.value).toBe('');
    }));

    it('should default the admins to an empty array in create mode', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(component.academyForm.get('admins')!.value).toEqual([]);
    }));

    it('should expose PUBLISHED and UNPUBLISHED as statusOptions', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect((component as any).statusOptions).toContain(AcademyStatus.PUBLISHED);
      expect((component as any).statusOptions).toContain(AcademyStatus.UNPUBLISHED);
    }));

    it('should report isEditMode as false in create mode', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect((component as any).isEditMode).toBeFalse();
    }));

    it('should load admin and superadmin users on init', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(userServiceSpy.findAllUsers).toHaveBeenCalledWith({
        userType: [UserType.ADMIN, UserType.SUPERADMIN],
      });
    }));

    it('should filter users to only ADMIN and SUPERADMIN types after loading', fakeAsync(() => {
      const mixedUsers: User[] = [
        mockAdminUser,
        { _id: 'user-id-1', email: 'user@example.com', userType: [UserType.USER], phone: '5553333' },
      ];
      userServiceSpy.findAllUsers.and.returnValue(of({ data: mixedUsers }) as any);

      fixture.detectChanges();
      tick();

      const loaded: User[] = (component as any).adminUsers();
      expect(loaded.every((u) => u.userType?.some((t) => t === UserType.ADMIN || t === UserType.SUPERADMIN))).toBeTrue();
      expect(loaded.find((u) => u._id === 'user-id-1')).toBeUndefined();
    }));

    it('should set isLoadingUsers to false after successful user load', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect((component as any).isLoadingUsers()).toBeFalse();
    }));

    it('should set isLoadingUsers to false even when user loading fails', fakeAsync(() => {
      userServiceSpy.findAllUsers.and.returnValue(throwError(() => new Error('network error')));

      fixture.detectChanges();
      tick();

      expect((component as any).isLoadingUsers()).toBeFalse();
    }));
  });

  // ─── Edit mode ────────────────────────────────────────────────────────────

  describe('edit mode (existing academy)', () => {
    beforeEach(async () => {
      await createComponent(mockExistingAcademy);
    });

    it('should create the component in edit mode', () => {
      expect(component).toBeTruthy();
    });

    it('should report isEditMode as true', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect((component as any).isEditMode).toBeTrue();
    }));

    it('should pre-populate the name field with the existing academy name', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(component.academyForm.get('name')!.value).toBe('Existing Academy');
    }));

    it('should pre-populate the status field with the existing academy status', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(component.academyForm.get('status')!.value).toBe(AcademyStatus.PUBLISHED);
    }));

    it('should pre-select admins from the loaded user list after users load', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      const selectedAdmins: User[] = component.academyForm.get('admins')!.value;
      expect(selectedAdmins.length).toBe(1);
      expect(selectedAdmins[0]._id).toBe('admin-id-1');
    }));

  });

  describe('edit mode — admin matching edge cases', () => {
    it('should match admins by _id from plain ID strings (not populated objects)', async () => {
      // Academy whose admins are raw ID strings rather than populated user objects
      const academyWithStringAdmin: Academy = {
        ...mockExistingAcademy,
        admins: ['admin-id-1'],
      };
      await createComponent(academyWithStringAdmin);

      fixture.detectChanges();
      await fixture.whenStable();

      const selectedAdmins: User[] = component.academyForm.get('admins')!.value;
      expect(selectedAdmins.length).toBe(1);
      expect(selectedAdmins[0]._id).toBe('admin-id-1');
    });

    it('should leave admins empty when none of the academy admins match the loaded users', async () => {
      const academyWithUnknownAdmin: Academy = {
        ...mockExistingAcademy,
        admins: [
          {
            _id: 'unknown-id',
            email: 'ghost@example.com',
            userType: [UserType.ADMIN],
            phone: '5559999',
          },
        ],
      };
      await createComponent(academyWithUnknownAdmin);

      fixture.detectChanges();
      await fixture.whenStable();

      const selectedAdmins: User[] = component.academyForm.get('admins')!.value;
      expect(selectedAdmins.length).toBe(0);
    });
  });

  // ─── Form submission: create ───────────────────────────────────────────────

  describe('onSubmit — create path', () => {
    beforeEach(async () => {
      await createComponent(); // no academy → create path
    });

    it('should not call createAcademy when the form is invalid', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      // form is invalid (name empty, admins empty)
      component.onSubmit();

      expect(academyServiceSpy.createAcademy).not.toHaveBeenCalled();
    }));

    it('should call createAcademy with name and admins array of IDs', fakeAsync(() => {
      academyServiceSpy.createAcademy.and.returnValue(of(mockSavedAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'New Academy',
        admins: [mockAdminUser],
      });

      component.onSubmit();
      tick();

      expect(academyServiceSpy.createAcademy).toHaveBeenCalledWith({
        name: 'New Academy',
        admins: ['admin-id-1'],
      });
    }));

    it('should not include status in the create payload (status is managed server-side)', fakeAsync(() => {
      academyServiceSpy.createAcademy.and.returnValue(of(mockSavedAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'Published Academy',
        admins: [mockAdminUser],
      });

      component.onSubmit();
      tick();

      const callArg = academyServiceSpy.createAcademy.calls.mostRecent().args[0];
      expect((callArg as any).status).toBeUndefined();
    }));

    it('should submit admins as an array of ID strings (not User objects)', fakeAsync(() => {
      academyServiceSpy.createAcademy.and.returnValue(of(mockSavedAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'Multi Admin Academy',
        admins: [mockAdminUser, mockSuperAdminUser],
      });

      component.onSubmit();
      tick();

      const callArg = academyServiceSpy.createAcademy.calls.mostRecent().args[0] as any;
      expect(callArg.admins).toEqual(['admin-id-1', 'superadmin-id-1']);
    }));

    it('should call context.completeWith with the saved academy on success', fakeAsync(() => {
      academyServiceSpy.createAcademy.and.returnValue(of(mockSavedAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'New Academy',
        admins: [mockAdminUser],
      });

      component.onSubmit();
      tick();

      expect(contextSpy.completeWith).toHaveBeenCalledWith(mockSavedAcademy);
    }));

    it('should show success alert on successful create', fakeAsync(() => {
      academyServiceSpy.createAcademy.and.returnValue(of(mockSavedAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'New Academy',
        admins: [mockAdminUser],
      });

      component.onSubmit();
      tick();

      expect(alertServiceSpy.open).toHaveBeenCalledWith(
        'აკადემია წარმატებით დაემატა!',
        { appearance: 'success' },
      );
    }));

    it('should show error alert when createAcademy fails', fakeAsync(() => {
      academyServiceSpy.createAcademy.and.returnValue(throwError(() => new Error('server error')));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'New Academy',
        admins: [mockAdminUser],
      });

      component.onSubmit();
      tick();

      expect(alertServiceSpy.open).toHaveBeenCalledWith(
        'შეცდომა აკადემიის დამატებისას.',
        { appearance: 'error' },
      );
    }));
  });

  // ─── Form submission: update ───────────────────────────────────────────────

  describe('onSubmit — update path', () => {
    beforeEach(async () => {
      await createComponent(mockExistingAcademy);
    });

    it('should not call updateAcademy when the form is invalid', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      component.academyForm.get('name')!.setValue('');
      component.academyForm.get('admins')!.setValue([]);

      component.onSubmit();

      expect(academyServiceSpy.updateAcademy).not.toHaveBeenCalled();
    }));

    it('should call updateAcademy with the academy ID, name, admins and status', fakeAsync(() => {
      const updatedAcademy = { ...mockExistingAcademy, name: 'Updated Academy' };
      academyServiceSpy.updateAcademy.and.returnValue(of(updatedAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'Updated Academy',
        admins: [mockAdminUser],
        status: AcademyStatus.PUBLISHED,
      });

      component.onSubmit();
      tick();

      expect(academyServiceSpy.updateAcademy).toHaveBeenCalledWith('academy-id-1', {
        name: 'Updated Academy',
        admins: ['admin-id-1'],
        status: AcademyStatus.PUBLISHED,
      });
    }));

    it('should include admins as an array of ID strings in the update payload', fakeAsync(() => {
      const updatedAcademy = { ...mockExistingAcademy };
      academyServiceSpy.updateAcademy.and.returnValue(of(updatedAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'Multi Admin Update',
        admins: [mockAdminUser, mockSuperAdminUser],
        status: AcademyStatus.PUBLISHED,
      });

      component.onSubmit();
      tick();

      const callArg = academyServiceSpy.updateAcademy.calls.mostRecent().args[1] as any;
      expect(callArg.admins).toEqual(['admin-id-1', 'superadmin-id-1']);
    }));

    it('should include the selected status in the update payload', fakeAsync(() => {
      const unpublishedAcademy = { ...mockExistingAcademy, status: AcademyStatus.UNPUBLISHED };
      academyServiceSpy.updateAcademy.and.returnValue(of(unpublishedAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'Existing Academy',
        admins: [mockAdminUser],
        status: AcademyStatus.UNPUBLISHED,
      });

      component.onSubmit();
      tick();

      const callArg = academyServiceSpy.updateAcademy.calls.mostRecent().args[1] as any;
      expect(callArg.status).toBe(AcademyStatus.UNPUBLISHED);
    }));

    it('should call context.completeWith with the updated academy on success', fakeAsync(() => {
      const updatedAcademy = { ...mockExistingAcademy, name: 'Updated Academy' };
      academyServiceSpy.updateAcademy.and.returnValue(of(updatedAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'Updated Academy',
        admins: [mockAdminUser],
        status: AcademyStatus.PUBLISHED,
      });

      component.onSubmit();
      tick();

      expect(contextSpy.completeWith).toHaveBeenCalledWith(updatedAcademy);
    }));

    it('should show success alert on successful update', fakeAsync(() => {
      academyServiceSpy.updateAcademy.and.returnValue(of(mockExistingAcademy));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'Existing Academy',
        admins: [mockAdminUser],
        status: AcademyStatus.PUBLISHED,
      });

      component.onSubmit();
      tick();

      expect(alertServiceSpy.open).toHaveBeenCalledWith(
        'აკადემია წარმატებით განახლდა!',
        { appearance: 'success' },
      );
    }));

    it('should show error alert when updateAcademy fails', fakeAsync(() => {
      academyServiceSpy.updateAcademy.and.returnValue(throwError(() => new Error('update error')));

      fixture.detectChanges();
      tick();

      component.academyForm.setValue({
        name: 'Existing Academy',
        admins: [mockAdminUser],
        status: AcademyStatus.PUBLISHED,
      });

      component.onSubmit();
      tick();

      expect(alertServiceSpy.open).toHaveBeenCalledWith(
        'შეცდომა აკადემიის განახლებისას.',
        { appearance: 'error' },
      );
    }));
  });

  // ─── Admins field visibility ───────────────────────────────────────────────

  describe('admins field availability', () => {
    it('should expose the admins control in create mode', async () => {
      await createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.academyForm.contains('admins')).toBeTrue();
    });

    it('should expose the admins control in edit mode', async () => {
      await createComponent(mockExistingAcademy);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.academyForm.contains('admins')).toBeTrue();
    });
  });

  // ─── onCancel ─────────────────────────────────────────────────────────────

  describe('onCancel', () => {
    beforeEach(async () => {
      await createComponent();
    });

    it('should call context.completeWith(null) when cancelled', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      component.onCancel();

      expect(contextSpy.completeWith).toHaveBeenCalledWith(null);
    }));
  });

  // ─── stringifyUser ────────────────────────────────────────────────────────

  describe('stringifyUser', () => {
    beforeEach(async () => {
      await createComponent();
    });

    it('should return "FirstName LastName (email)" when both names exist', () => {
      const result = component.stringifyUser(mockAdminUser);
      expect(result).toBe('Admin One (admin@example.com)');
    });

    it('should return just the email when no first or last name is set', () => {
      const userNoName: User = { _id: 'u1', email: 'anon@example.com', userType: [UserType.ADMIN], phone: '000' };
      expect(component.stringifyUser(userNoName)).toBe('anon@example.com');
    });

    it('should handle a user with only firstName', () => {
      const userFirstOnly: User = { ...mockAdminUser, lastName: undefined };
      expect(component.stringifyUser(userFirstOnly)).toBe('Admin (admin@example.com)');
    });
  });

  // ─── stringifyStatus ──────────────────────────────────────────────────────

  describe('stringifyStatus', () => {
    beforeEach(async () => {
      await createComponent();
    });

    it('should return the Georgian label for PUBLISHED', () => {
      expect(component.stringifyStatus(AcademyStatus.PUBLISHED)).toBe('გამოქვეყნებული');
    });

    it('should return the Georgian label for UNPUBLISHED', () => {
      expect(component.stringifyStatus(AcademyStatus.UNPUBLISHED)).toBe('გამოუქვეყნებელი');
    });
  });
});
