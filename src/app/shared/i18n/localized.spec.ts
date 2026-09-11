import { LANG_STORAGE_KEY, switchLang } from './lang';
import { localizedCourtName, localizedName, localizedText } from './localized';

describe('localized (operator content)', () => {
  afterEach(() => {
    switchLang('ka');
    localStorage.removeItem(LANG_STORAGE_KEY);
  });

  describe('localizedName', () => {
    it('should keep the Georgian name in a Georgian session', () => {
      switchLang('ka');
      expect(localizedName({ name: 'პადელ ვაკე', nameEn: 'Padel Vake' })).toBe('პადელ ვაკე');
    });

    it('should prefer the operator English name in an English session', () => {
      switchLang('en');
      expect(localizedName({ name: 'პადელ ვაკე', nameEn: 'Padel Vake' })).toBe('Padel Vake');
    });

    // The `*En` fields are optional, so a half-translated catalogue must not
    // render blanks — the Georgian original is always the floor.
    it('should fall back to Georgian when the operator left nameEn blank', () => {
      switchLang('en');
      expect(localizedName({ name: 'პადელ ვაკე' })).toBe('პადელ ვაკე');
      expect(localizedName({ name: 'პადელ ვაკე', nameEn: '' })).toBe('პადელ ვაკე');
    });

    it('should tolerate a missing entity', () => {
      switchLang('en');
      expect(localizedName(null)).toBe('');
      expect(localizedName(undefined)).toBe('');
    });
  });

  describe('localizedText', () => {
    it('should swap only when an English value exists', () => {
      switchLang('en');
      expect(localizedText('ქართული', 'English')).toBe('English');
      expect(localizedText('ქართული', '')).toBe('ქართული');
      switchLang('ka');
      expect(localizedText('ქართული', 'English')).toBe('ქართული');
    });
  });

  describe('localizedCourtName', () => {
    it('should read the snapshot pair carried by booking and stats rows', () => {
      switchLang('en');
      expect(localizedCourtName({ courtName: 'კორტი 1', courtNameEn: 'Court 1' })).toBe('Court 1');
      switchLang('ka');
      expect(localizedCourtName({ courtName: 'კორტი 1', courtNameEn: 'Court 1' })).toBe('კორტი 1');
    });

    // Bookings created before the court rename carry no snapshot at all.
    it('should return an empty string when nothing was snapshotted', () => {
      switchLang('en');
      expect(localizedCourtName({})).toBe('');
    });
  });
});
