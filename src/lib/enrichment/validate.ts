/**
 * Field validators shared between adapter save paths. Each takes a raw string
 * and returns whether it looks well-formed; adapters typically also `.trim()`
 * before persisting and log skip-reasons into `finalSavedFields`.
 */

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const URL_RE = /^(https?:\/\/|www\.)\S+\.\S+/i;

export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function isValidPhone(v: string): boolean {
  return v.replace(/\D/g, "").length >= 10;
}

export function isValidUrl(v: string): boolean {
  return URL_RE.test(v.trim());
}
