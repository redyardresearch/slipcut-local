export const CODICE_FISCALE_PATTERN =
  /(?:[A-Z][AEIOU][AEIOUX]|[AEIOU]X{2}|[B-DF-HJ-NP-TV-Z]{2}[A-Z]){2}(?:[0-9LMNP-V]{2}(?:[A-EHLMPR-T](?:[04LQ][1-9MNP-V]|[15MR][0-9LMNP-V]|[26NS][0-8LMNP-U])|[DHPS][37PT][0L]|[ACELMRT][37PT][01LM]|[AC-EHLMPR-T][26NS][9V])|(?:[02468LNQSU][048LQU]|[13579MPRTV][26NS])B[26NS][9V])(?:[A-MZ][1-9MNP-V][0-9LMNP-V]{2}|[A-M][0L](?:[1-9MNP-V][0-9LMNP-V]|[0L][1-9MNP-V]))[A-Z]/gi;

const ODD: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

const EVEN: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12,
  N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
};

const VOWELS = 'AEIOU';

export function normalizeCodiceFiscale(input: string): string {
  return input.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export function isValidCodiceFiscaleChecksum(input: string): boolean {
  const cf = normalizeCodiceFiscale(input);
  if (!/^[A-Z0-9]{16}$/.test(cf)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    const ch = cf[i];
    sum += (i + 1) % 2 === 1 ? ODD[ch] : EVEN[ch];
  }
  return cf[15] === String.fromCharCode('A'.charCodeAt(0) + (sum % 26));
}

export function extractCodiciFiscali(text: string): string[] {
  const normalizedText = text.replace(/\s+/g, ' ').toUpperCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of normalizedText.matchAll(CODICE_FISCALE_PATTERN)) {
    const cf = normalizeCodiceFiscale(match[0]);
    if (!seen.has(cf) && isValidCodiceFiscaleChecksum(cf)) {
      seen.add(cf);
      out.push(cf);
    }
  }
  return out;
}

export function extractPrimaryCodiceFiscale(text: string): string | null {
  return extractCodiciFiscali(text)[0] ?? null;
}

export function normalizePersonName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z' -]/gi, ' ')
    .replace(/[']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function onlyLetters(input: string): string {
  return normalizePersonName(input).replace(/[^A-Z]/g, '');
}

function consonants(input: string): string[] {
  return onlyLetters(input).split('').filter((ch) => !VOWELS.includes(ch));
}

function vowels(input: string): string[] {
  return onlyLetters(input).split('').filter((ch) => VOWELS.includes(ch));
}

export function codiceFiscaleSurnameCode(surname: string): string {
  return [...consonants(surname), ...vowels(surname), 'X', 'X', 'X'].slice(0, 3).join('');
}

export function codiceFiscaleGivenNameCode(givenName: string): string {
  const cons = consonants(givenName);
  const chosen = cons.length > 3 ? [cons[0], cons[2], cons[3]] : cons;
  return [...chosen, ...vowels(givenName), 'X', 'X', 'X'].slice(0, 3).join('');
}

export function codiceFiscaleNamePrefix(surname: string, givenName: string): string {
  return `${codiceFiscaleSurnameCode(surname)}${codiceFiscaleGivenNameCode(givenName)}`;
}

export interface CodiceFiscaleNameMatch {
  normalizedName: string;
  surname: string;
  givenName: string;
  prefix: string;
}

/**
 * Match a candidate full name against the first six characters of a Codice
 * Fiscale. Payroll exports usually print names as SURNAME GIVEN_NAME, but both
 * surname and given name can have multiple words. Try every possible split and
 * keep the one whose generated CF name prefix exactly matches the CF prefix.
 */
export function matchNameToCodiceFiscale(candidate: string, codiceFiscale: string | null): CodiceFiscaleNameMatch | null {
  if (!codiceFiscale) return null;
  const cf = normalizeCodiceFiscale(codiceFiscale);
  if (cf.length < 6) return null;

  const normalizedName = normalizePersonName(candidate)
    .replace(/\b(SIG|SIGRA|SIGNOR|SIGNORA|DOTT|DOTTSSA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = normalizedName.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return null;
  if (tokens.some((token) => token.length < 2)) return null;

  const expectedPrefix = cf.slice(0, 6);
  for (let split = 1; split < tokens.length; split += 1) {
    const surname = tokens.slice(0, split).join(' ');
    const givenName = tokens.slice(split).join(' ');
    const prefix = codiceFiscaleNamePrefix(surname, givenName);
    if (prefix === expectedPrefix) {
      return { normalizedName, surname, givenName, prefix };
    }
  }

  return null;
}
