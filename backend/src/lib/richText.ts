/**
 * Rich-text handling for reading lessons.
 *
 * Instructors author HTML in the browser; the API is the only writer to the
 * database, so sanitisation happens **server-side on write** and the stored
 * value is what learners receive. The allow-list is deliberately small: it
 * covers the MOOC reading vocabulary (headings, lists, tables, code, links,
 * images) and nothing that can execute.
 */
import sanitizeHtml from 'sanitize-html';
import { READING_LIMITS } from '../config/constants';

export const RICH_TEXT_ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h2',
  'h3',
  'h4',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'div',
] as const;

/** Attributes kept per tag. Everything else (`style`, `class`, `on*`) is dropped. */
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  th: ['colspan', 'rowspan', 'scope'],
  td: ['colspan', 'rowspan'],
  ol: ['start'],
  code: ['class'],
  pre: ['class'],
  span: ['class'],
  div: ['class'],
};

/** Only syntax-highlighting class names survive on `code`/`pre`/`span`. */
function filterClassName(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const allowed = className
    .split(/\s+/)
    .filter((token) => /^language-[a-z0-9+#-]+$/i.test(token))
    .join(' ');
  return allowed || undefined;
}

export function sanitizeReadingHtml(input: string | null | undefined): string {
  if (!input) return '';

  return sanitizeHtml(input, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    // Drop the *contents* of executable elements instead of flattening their
    // text into the lesson.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe'],
    transformTags: {
      a: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs, rel: 'noopener noreferrer' };
        if (attribs.target === '_blank') next.target = '_blank';
        else delete next.target;
        return { tagName, attribs: next };
      },
      code: (_tagName, attribs) => {
        const className = filterClassName(attribs.class);
        const next: Record<string, string> = {};
        if (className) next.class = className;
        return { tagName: 'code', attribs: next };
      },
      span: (_tagName, attribs) => {
        const className = filterClassName(attribs.class);
        const next: Record<string, string> = {};
        if (className) next.class = className;
        return { tagName: 'span', attribs: next };
      },
      div: () => ({ tagName: 'div', attribs: {} }),
    },
  }).trim();
}

/** Plain-text projection used for word counts and accessibility fallbacks. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(html: string | null | undefined): number {
  const text = htmlToPlainText(html);
  if (!text) return 0;
  return text.split(' ').filter(Boolean).length;
}

/**
 * Estimated reading time. An explicit instructor estimate always wins; otherwise
 * words are divided by the configured reading speed and rounded up, with a
 * one-minute floor for any non-empty section.
 */
export function estimateReadingMinutes(
  html: string | null | undefined,
  explicitMinutes?: number | null,
  wordsPerMinute: number = READING_LIMITS.wordsPerMinute,
): number {
  if (explicitMinutes && explicitMinutes > 0) return explicitMinutes;
  const words = countWords(html);
  if (words === 0) return 0;
  return Math.max(1, Math.ceil(words / Math.max(50, wordsPerMinute)));
}

/**
 * Validates a link an instructor attaches to a lesson (external article, Google
 * Drive file, references). Only absolute `http`/`https` URLs are accepted —
 * `javascript:`/`data:` payloads never reach the database, and protocol-relative
 * URLs are rejected because they inherit the API's scheme.
 */
export function validateExternalUrl(raw: string | null | undefined): { ok: true; url: string } | { ok: false; reason: string } {
  const value = (raw ?? '').trim();
  if (!value) return { ok: false, reason: 'A URL is required.' };
  if (value.length > 2000) return { ok: false, reason: 'The URL is too long.' };
  if (value.startsWith('//')) return { ok: false, reason: 'Protocol-relative URLs are not allowed.' };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'Enter a full URL starting with https://' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https links are allowed.' };
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    return { ok: false, reason: 'The URL must include a valid host name.' };
  }

  return { ok: true, url: parsed.toString() };
}

export interface ReadingReference {
  label: string;
  url: string;
  note: string | null;
}

/**
 * Normalises the instructor's reference list: labels are required, URLs are
 * validated, and the list is capped so a lesson cannot embed an unbounded set.
 */
export function normalizeReferences(raw: unknown): { references: ReadingReference[]; issues: string[] } {
  if (raw === undefined || raw === null) return { references: [], issues: [] };
  if (!Array.isArray(raw)) return { references: [], issues: ['References must be a list.'] };

  const issues: string[] = [];
  const references: ReadingReference[] = [];

  raw.slice(0, 20).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      issues.push(`Reference ${index + 1} is not an object.`);
      return;
    }
    const candidate = entry as Record<string, unknown>;
    const label = String(candidate.label ?? '').trim();
    const note = candidate.note === undefined || candidate.note === null ? null : String(candidate.note).trim() || null;

    if (!label) {
      issues.push(`Reference ${index + 1} needs a label.`);
      return;
    }

    const validated = validateExternalUrl(typeof candidate.url === 'string' ? candidate.url : '');
    if (!validated.ok) {
      issues.push(`Reference "${label}": ${validated.reason}`);
      return;
    }

    references.push({ label, url: validated.url, note });
  });

  return { references, issues };
}
