export const UI_LOCALES = {
  en: { label: 'English', direction: 'ltr' },
};

export function directionFor(code) {
  return UI_LOCALES[code]?.direction || 'ltr';
}

export function localeAlternates() {
  return [];
}
