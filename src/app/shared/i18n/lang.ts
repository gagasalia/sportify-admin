import { signal } from '@angular/core';
import { EN } from './en';

/**
 * Language plumbing — the admin port of the webapp's i18n design
 * (sport-spot-webapp docs/16-i18n-design.md, v2 — INSTANT switching).
 *
 * The language lives in a SIGNAL. `tr()` reads it, so anything that calls
 * `tr()` while Angular is watching — template expressions, the (impure) `t`
 * pipe, `computed()`s — re-evaluates the moment the language flips. No page
 * reload.
 *
 * The one trap this design forbids: BAKING a translation into a value at
 * import/construction time (`const X = tr('…')`, `{ label: tr('…') }`).
 * Those evaluate once and go stale on toggle. Keep stored values in RAW
 * Georgian and translate at RENDER time (`| t`, `tr()` in a computed, or the
 * `liveLabels`/`liveList` proxies below).
 */

export type AppLang = 'ka' | 'en';

export const LANG_STORAGE_KEY = 'ss_lang';

function readStoredLang(): AppLang {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === 'en' ? 'en' : 'ka';
  } catch {
    return 'ka';
  }
}

const langSignal = signal<AppLang>(readStoredLang());

/** Reactive read — safe anywhere; registers a dependency in reactive contexts. */
export function currentLang(): AppLang {
  return langSignal();
}

export function isEnglish(): boolean {
  return langSignal() === 'en';
}

/**
 * Gettext lookup on the LIVE language: Georgian source string in, English (or
 * the unchanged Georgian) out. DI-free — usable from pure utils and templates.
 */
export function tr(georgian: string): string {
  if (langSignal() !== 'en') {
    return georgian;
  }
  return EN[georgian] ?? georgian;
}

/** Persist + flip the signal — the UI re-renders in place (no reload). */
export function switchLang(lang: AppLang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* private mode — the toggle just won't stick */
  }
  langSignal.set(lang);
}

/**
 * Wraps a RAW-Georgian label record so every read translates on the fly:
 * `LABELS[key]` stays the call sites' shape, but each access goes through
 * `tr()` — reactive, never baked.
 */
export function liveLabels<T extends Record<PropertyKey, string>>(raw: T): T {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'string' ? tr(value) : value;
    },
  });
}

/** Same idea for indexed string lists (month/weekday label arrays). */
export function liveList(raw: readonly string[]): readonly string[] {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'string' && String(Number(prop)) === prop
        ? tr(value)
        : value;
    },
  }) as readonly string[];
}
