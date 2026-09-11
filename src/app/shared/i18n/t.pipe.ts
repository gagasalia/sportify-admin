import { Pipe, PipeTransform } from '@angular/core';
import { tr } from './lang';

/**
 * `{{ 'ქართული ტექსტი' | t }}` → the live-language variant. IMPURE on
 * purpose (same as the webapp's docs/16 v2): the language can change WITHOUT
 * a reload, and an impure transform re-runs on change detection while its
 * `tr()` signal read keeps the view subscribed to language flips. The lookup
 * is one object access — cheap enough to run per CD cycle.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TPipe implements PipeTransform {
  transform(georgian: string): string {
    return tr(georgian);
  }
}
