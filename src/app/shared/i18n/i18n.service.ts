import { Injectable, Signal, computed, effect } from '@angular/core';
import { AppLang, currentLang, isEnglish, switchLang, tr } from './lang';

/**
 * Reactive translator front (mirrors the webapp's I18nService). `lang` is a
 * live signal; toggling flips it IN PLACE (no reload) and every `tr()`/`| t`
 * consumer re-renders. The service also keeps `<html lang>` in sync.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang: Signal<AppLang> = computed(() => currentLang());
  readonly isEnglish: Signal<boolean> = computed(() => isEnglish());

  /** Arrow property so templates/classes can alias it without losing `this`. */
  readonly t = (georgian: string): string => tr(georgian);

  constructor() {
    effect(() => {
      const lang = this.lang();
      if (typeof document !== 'undefined') {
        document.documentElement.lang = lang;
      }
    });
  }

  toggle(): void {
    switchLang(isEnglish() ? 'ka' : 'en');
  }
}
