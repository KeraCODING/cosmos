import i18next from 'i18next';
import azCommon from '../../../../locales/az/common.json';
import enCommon from '../../../../locales/en/common.json';
import ruCommon from '../../../../locales/ru/common.json';
import azAstro from '../../../../locales/az/astronomy.json';
import ruAstro from '../../../../locales/ru/astronomy.json';
import enAstro from '../../../../locales/en/astronomy.json';

export type Language = 'az' | 'en' | 'ru';
export const LANGUAGES: [Language, string][] = [['az', 'Azərbaycan dili'], ['en', 'English'], ['ru', 'Русский']];
export async function initI18n(lng: Language) {
  await i18next.init({
    lng, fallbackLng: false, defaultNS: 'common', ns: ['common', 'astronomy'], returnNull: false, interpolation: { escapeValue: false },
    resources: { az: { common: azCommon, astronomy: azAstro }, en: { common: enCommon, astronomy: enAstro }, ru: { common: ruCommon, astronomy: ruAstro } },
  });
  document.documentElement.lang = lng;
}
export const t = (key: string, options?: Record<string, unknown>) => i18next.t(key, options as never) as unknown as string;
export const tList = (key: string) => i18next.t(key, { returnObjects: true } as never) as unknown as string[];
export const language = () => i18next.language as Language;
export async function setLanguage(lng: Language) { await i18next.changeLanguage(lng); document.documentElement.lang = lng; }
export const bodyName = (id: string, lng?: Language) => i18next.t(`astronomy:bodies.${id}.name`, (lng ? { lng } : {}) as never) as unknown as string;
// Electron ships without Azerbaijani locale data, so separators and month names come from our own tables.
function formatNumber(v: number, options: Intl.NumberFormatOptions, lng: Language = language()) {
  const comma = lng !== 'en', group = lng === 'az' ? '.' : lng === 'ru' ? '\u00a0' : ',';
  return new Intl.NumberFormat('en-US', options).formatToParts(v).map((p) => (p.type === 'group' ? group : p.type === 'decimal' ? (comma ? ',' : '.') : p.type === 'minusSign' ? '−' : p.value)).join('');
}
export const num = (v: number, digits = 3, lng?: Language) => formatNumber(v, { maximumSignificantDigits: Math.max(digits, 1) }, lng);
export const plain = (v: number, lng?: Language) => formatNumber(v, { maximumFractionDigits: 6 }, lng);
export const dateOnly = (d: Date) => `${d.getUTCDate()} ${tList('date.months')[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const dateTime = (d: Date) => `${dateOnly(d)}, ${d.toISOString().slice(11, 16)} UTC`;
