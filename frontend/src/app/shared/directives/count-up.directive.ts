import {
  Directive,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  AfterViewInit,
  SimpleChanges,
  Inject,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { gsap } from 'gsap';

/**
 * GSAP-driven number counter.
 *
 *   <span [kmsCountUp]="amount"
 *         [kmsCountFormat]="'1.0-0'"
 *         [kmsCountDuration]="900">0</span>
 *
 * Respects `prefers-reduced-motion`: when reduced, sets value instantly.
 */
@Directive({
  selector: '[kmsCountUp]',
  standalone: true,
})
export class CountUpDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input('kmsCountUp') target = 0;
  @Input('kmsCountFormat') format: string = '1.0-0';
  @Input('kmsCountDuration') duration = 900;
  @Input('kmsCountPrefix') prefix = '';
  @Input('kmsCountSuffix') suffix = '';

  private state = { value: 0 };
  private tween: gsap.core.Tween | null = null;
  private ready = false;
  private readonly fmt: Intl.NumberFormat;
  private readonly isBrowser: boolean;

  constructor(
    private el: ElementRef<HTMLElement>,
    @Inject(PLATFORM_ID) platformId: Object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    // parseAngularNumberFormat returns [fullMatch, integerDigits, minFrac, maxFrac]
    const parsed = this.parseAngularNumberFormat(this.format);
    const minFrac = Number(parsed[2] ?? '0');
    const maxFrac = Number(parsed[3] ?? '0');
    this.fmt = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: minFrac,
      maximumFractionDigits: Math.max(minFrac, maxFrac),
    });
  }

  ngAfterViewInit(): void {
    this.ready = true;
    this.render(this.state.value);
    this.animateTo(this.target);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.ready) return;
    if (changes['target']) this.animateTo(this.target);
  }

  ngOnDestroy(): void {
    this.tween?.kill();
  }

  private animateTo(value: number): void {
    if (!this.isBrowser) {
      this.render(value);
      return;
    }
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.state.value = value;
      this.render(value);
      return;
    }
    this.tween?.kill();
    this.tween = gsap.to(this.state, {
      value,
      duration: this.duration / 1000,
      ease: 'power2.out',
      onUpdate: () => this.render(this.state.value),
    });
  }

  private render(value: number): void {
    const formatted = this.fmt.format(Math.round(value * 100) / 100);
    this.el.nativeElement.textContent = `${this.prefix}${formatted}${this.suffix}`;
  }

  // Accept Angular's number-pipe-style format like '1.0-0' / '1.0-2'.
  private parseAngularNumberFormat(f: string): string[] {
    const m = /^(\d+)\.(\d+)-(\d+)$/.exec(f);
    return m ? m : ['', '1', '0', '0'];
  }
}
