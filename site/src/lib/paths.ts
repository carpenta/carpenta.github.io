export type Locale = 'ko' | 'en';

export const LOCALES: Locale[] = ['ko', 'en'];

/** `path`는 로케일 접두사 없이 `/`로 시작하고 `/`로 끝난다. */
export function localePath(locale: Locale, path: string): string {
  return locale === 'ko' ? path : `/en${path}`;
}

export function altLocale(locale: Locale): Locale {
  return locale === 'ko' ? 'en' : 'ko';
}
