import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  forwardRef,
  inject,
  signal,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { Academy } from '../models/academy.model';
import { TPipe } from '../i18n/t.pipe';

/**
 * Academy dropdown that renders each academy's LOGO next to its name — a
 * native <option> cannot host an <img>, so every academy <select> in the
 * admin swaps to this. Styled as .ss-input and implements ControlValueAccessor,
 * so it drops into both [(ngModel)] filter bindings and formControlName forms.
 * The value is the academy _id ('' = the caller-labelled empty choice).
 */
@Component({
  selector: 'ss-academy-select',
  standalone: true,
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AcademySelectComponent),
      multi: true,
    },
  ],
  template: `
    <button
      type="button"
      class="ss-input as-trigger"
      role="combobox"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="ariaLabel ? (ariaLabel | t) : null"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown)="onTriggerKeydown($event)"
    >
      @if (selected(); as academy) {
        @if (logoOf(academy); as logo) {
          <img class="as-logo" [src]="logo" alt="" (error)="markBroken(academy)" />
        } @else {
          <span class="as-logo as-monogram" aria-hidden="true">{{ monogramOf(academy) }}</span>
        }
        <span class="as-label georgian-text" lang="ka">{{ academy.name }}</span>
      } @else {
        <span class="as-label as-label--empty georgian-text" lang="ka">{{ (emptyLabel ?? '') | t }}</span>
      }
      <svg class="as-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    @if (open()) {
      <div class="as-panel" role="listbox">
        @if (emptyLabel !== null) {
          <button
            type="button"
            class="as-opt"
            role="option"
            [class.is-active]="activeIndex() === 0"
            [attr.aria-selected]="!value()"
            (click)="pick('')"
            (mouseenter)="activeIndex.set(0)"
          >
            <span class="as-logo as-monogram as-monogram--all" aria-hidden="true">✳</span>
            <span class="as-label georgian-text" lang="ka">{{ emptyLabel | t }}</span>
          </button>
        }
        @for (academy of academies; track academy._id; let i = $index) {
          <button
            type="button"
            class="as-opt"
            role="option"
            [class.is-active]="activeIndex() === i + emptyOffset"
            [attr.aria-selected]="value() === academy._id"
            (click)="pick(academy._id!)"
            (mouseenter)="activeIndex.set(i + emptyOffset)"
          >
            @if (logoOf(academy); as logo) {
              <img class="as-logo" [src]="logo" alt="" loading="lazy" (error)="markBroken(academy)" />
            } @else {
              <span class="as-logo as-monogram" aria-hidden="true">{{ monogramOf(academy) }}</span>
            }
            <span class="as-label georgian-text" lang="ka">{{ academy.name }}</span>
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }
      .as-trigger {
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
        cursor: pointer;
      }
      .as-trigger:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .as-logo {
        flex: 0 0 auto;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        object-fit: cover;
        background: var(--surface-2, var(--surface));
      }
      .as-monogram {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-dim, var(--text));
        border: 1px solid var(--hairline-2);
      }
      .as-monogram--all {
        font-size: 10px;
      }
      .as-label {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .as-label--empty {
        color: var(--text-dim, var(--text));
      }
      .as-chevron {
        flex: 0 0 auto;
        color: var(--text-faint, currentColor);
      }
      .as-panel {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        z-index: 60;
        max-height: 280px;
        overflow-y: auto;
        padding: 4px;
        border: 1px solid var(--hairline-2);
        border-radius: var(--r-md);
        background: var(--surface);
        box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
      }
      .as-opt {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        border: 0;
        border-radius: calc(var(--r-md) - 4px);
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
      }
      .as-opt.is-active,
      .as-opt:hover {
        background: var(--accent-soft, rgb(0 0 0 / 0.06));
      }
      .as-opt[aria-selected='true'] .as-label {
        font-weight: 600;
      }
    `,
  ],
})
export class AcademySelectComponent implements ControlValueAccessor {
  /** Academies to offer (with `logo` when the API returned one). */
  @Input() academies: Academy[] = [];
  /**
   * Label for the '' choice (e.g. "ყველა აკადემია"); null = no empty choice.
   * Callers pass RAW Georgian — the template runs it through `| t`, so it
   * follows the live language (already-English text passes through unchanged).
   */
  @Input() emptyLabel: string | null = null;
  @Input() ariaLabel = '';

  readonly value = signal<string>('');
  readonly open = signal(false);
  readonly disabled = signal(false);
  readonly activeIndex = signal(0);

  private readonly broken = new Set<string>();
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cdr = inject(ChangeDetectorRef);

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  get emptyOffset(): number {
    return this.emptyLabel === null ? 0 : 1;
  }

  selected(): Academy | null {
    const id = this.value();
    return (id && this.academies.find((a) => a._id === id)) || null;
  }

  logoOf(academy: Academy): string | null {
    const logo = academy.logo;
    if (!logo?.url || this.broken.has(academy._id ?? '')) {
      return null;
    }
    return logo.thumbUrl || logo.url;
  }

  monogramOf(academy: Academy): string {
    return (academy.name ?? '').trim().charAt(0).toUpperCase();
  }

  markBroken(academy: Academy): void {
    if (academy._id) {
      this.broken.add(academy._id);
      this.cdr.markForCheck();
    }
  }

  toggle(): void {
    if (this.disabled()) {
      return;
    }
    this.open() ? this.close() : this.openPanel();
  }

  pick(id: string): void {
    this.value.set(id);
    this.onChange(id);
    this.close();
  }

  private openPanel(): void {
    const id = this.value();
    const selectedIdx = this.academies.findIndex((a) => a._id === id);
    this.activeIndex.set(
      selectedIdx >= 0 ? selectedIdx + this.emptyOffset : 0,
    );
    this.open.set(true);
  }

  private close(): void {
    if (this.open()) {
      this.open.set(false);
      this.onTouched();
    }
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    const total = this.academies.length + this.emptyOffset;
    if (!this.open()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        this.openPanel();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex.set(Math.min(this.activeIndex() + 1, total - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        this.activeIndex.set(0);
        break;
      case 'End':
        event.preventDefault();
        this.activeIndex.set(total - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const idx = this.activeIndex() - this.emptyOffset;
        this.pick(idx < 0 ? '' : (this.academies[idx]?._id ?? ''));
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close();
      this.cdr.markForCheck();
    }
  }

  // ── ControlValueAccessor ──────────────────────────────────────────────────
  writeValue(value: string | null | undefined): void {
    this.value.set(value ?? '');
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
