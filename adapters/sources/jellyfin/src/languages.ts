/**
 * Jellyfin names a stream's language in ISO 639-2 — `eng`, `deu` or `ger` —
 * and the domain in BCP 47, where a language with a two-letter code must use
 * it. A code missing here passes through: most of the rest have no two-letter
 * code, and are valid as they are.
 */
const TWO_LETTER: Readonly<Record<string, string>> = {
  ara: 'ar', bul: 'bg', cat: 'ca', ces: 'cs', cze: 'cs', chi: 'zh', zho: 'zh', dan: 'da', deu: 'de', ger: 'de',
  ell: 'el', gre: 'el', eng: 'en', spa: 'es', est: 'et', fas: 'fa', per: 'fa', fin: 'fi', fra: 'fr', fre: 'fr',
  heb: 'he', hin: 'hi', hrv: 'hr', hun: 'hu', ind: 'id', ita: 'it', jpn: 'ja', kor: 'ko', lit: 'lt', lav: 'lv',
  msa: 'ms', may: 'ms', nld: 'nl', dut: 'nl', nor: 'no', nob: 'nb', nno: 'nn', pol: 'pl', por: 'pt', ron: 'ro',
  rum: 'ro', rus: 'ru', slk: 'sk', slo: 'sk', slv: 'sl', srp: 'sr', swe: 'sv', tha: 'th', tur: 'tr', ukr: 'uk',
  vie: 'vi', kur: 'ku', sqi: 'sq', alb: 'sq', bos: 'bs', mkd: 'mk', mac: 'mk', isl: 'is', ice: 'is', gle: 'ga',
};

export function bcp47(language: string | undefined): string | undefined {
  if (!language || language === 'und') return undefined;
  const code = language.toLowerCase();
  return TWO_LETTER[code] ?? code;
}
