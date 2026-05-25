import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

// Defense-in-depth: validate URL scheme + host BEFORE handing to
// bypassSecurityTrustResourceUrl. Without this, any javascript:/data:/vbscript:
// URL stored in the backend would execute in the iframe's same-origin context
// and be able to read parent.localStorage (where the JWT lives).
const ALLOWED_HOST_SUFFIXES = [
  'zoom.us',
  'zoomgov.com',
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'vimeo.com',
  'player.vimeo.com'
];

function isAllowedEmbedUrl(value: string): boolean {
  if (!value || value.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(suffix =>
    host === suffix || host.endsWith('.' + suffix)
  );
}

@Pipe({
  name: 'safe',
  standalone: true
})
export class SafePipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeResourceUrl {
    if (!value || !isAllowedEmbedUrl(value)) {
      return this.sanitizer.bypassSecurityTrustResourceUrl('about:blank');
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(value);
  }
}
