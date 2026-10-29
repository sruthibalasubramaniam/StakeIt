/**
 * Turning a document into reading sections.
 *
 * Pure on purpose — no I/O, no Prisma — so the splitting heuristics can be
 * unit-tested against real documents without a database.
 *
 * The rule that shapes everything here: **a section must be something a learner
 * can read and then answer a question about.** That means splitting on headings
 * when the document has them, and falling back to word-capped chunks when it does
 * not. Very short tails are merged rather than left as a one-paragraph section.
 */

export type DocumentKind = 'PDF' | 'DOCX' | 'MARKDOWN' | 'TEXT' | 'UNSUPPORTED';

export interface ExtractedSection {
  title: string;
  /** Sanitised later by the normal reading pipeline; raw here. */
  bodyHtml: string;
  wordCount: number;
}

const WORD_TARGET = 900;
// Only genuinely tiny fragments are folded into the previous section. At 40 words
// a short handout collapsed into one section, which defeats per-section checks.
const MIN_WORDS = 18;

/** Sniff the real format from bytes first, extension second. */
export function detectDocumentKind(buffer: Buffer, fileName: string): DocumentKind {
  const name = fileName.toLowerCase();

  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'PDF';
  // DOCX is a zip: "PK\x03\x04", and contains word/document.xml.
  if (buffer.subarray(0, 2).toString('latin1') === 'PK') return 'DOCX';

  if (name.endsWith('.pdf')) return 'PDF';
  if (name.endsWith('.docx')) return 'DOCX';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'MARKDOWN';
  if (name.endsWith('.txt')) return 'TEXT';
  return 'UNSUPPORTED';
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphsToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean);
      /*
       * Only a real bullet/number marker makes a list. Length alone is not enough:
       * PDF text arrives hard-wrapped at ~80 characters, so "all lines are short"
       * turned ordinary prose into bullets. Wrapped lines are rejoined instead.
       */
      const bullet = /^(?:[-•*]|\d+[.)])\s+/;
      if (lines.length > 1 && lines.every((line) => bullet.test(line))) {
        return `<ul>${lines
          .map((line) => `<li>${escapeHtml(line.replace(bullet, ''))}</li>`)
          .join('')}</ul>`;
      }
      return `<p>${escapeHtml(lines.join(' '))}</p>`;
    })
    .join('\n');
}

interface HeadingMatch {
  index: number;
  length: number;
  title: string;
}

const MARKDOWN_HEADING = /^(#{1,6})\s+(.+)$/;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\.?\s+(\S.{2,80})$/;
const CAPS_HEADING = /^([A-Z][A-Z0-9 &,'’\-]{6,70})$/;

function findHeadings(lines: string[]): HeadingMatch[] {
  const found: HeadingMatch[] = [];
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const markdown = MARKDOWN_HEADING.exec(trimmed);
    if (markdown) {
      found.push({ index: offset, length: line.length, title: markdown[2]!.trim() });
    } else if (
      trimmed.length >= 4 &&
      trimmed.length <= 90 &&
      NUMBERED_HEADING.test(trimmed) &&
      // "2019. was a good year" should not become a heading.
      !/^\d+\.\s/.test(trimmed)
    ) {
      found.push({ index: offset, length: line.length, title: trimmed.replace(/^\d+(?:\.\d+)*\.?\s+/, '') });
    } else if (CAPS_HEADING.test(trimmed) && countWords(trimmed) <= 12) {
      found.push({ index: offset, length: line.length, title: trimmed });
    }
    offset += line.length + 1;
  }

  return found;
}

function chunkByWords(text: string, title: string): ExtractedSection[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: ExtractedSection[] = [];
  for (let start = 0; start < words.length; start += WORD_TARGET) {
    const slice = words.slice(start, start + WORD_TARGET);
    out.push({
      title: start === 0 ? title : `${title} (continued)`,
      bodyHtml: `<p>${escapeHtml(slice.join(' '))}</p>`,
      wordCount: slice.length,
    });
  }
  return out;
}

/**
 * Split plain text (PDF text layer, .md, .txt) into sections.
 *
 * Headings win. Where a document has none — the common case for a PDF — it is
 * chunked by word count so checkpoints still have a bounded thing to attach to.
 */
export function splitPlainText(text: string, fallbackTitle: string): ExtractedSection[] {
  const normalised = text.replace(/\r\n?/g, '\n').trim();
  if (!normalised) return [];

  const lines = normalised.split('\n');
  const headings = findHeadings(lines);

  if (headings.length < 2) return chunkByWords(normalised, fallbackTitle);

  const sections: ExtractedSection[] = [];
  const preamble = normalised.slice(0, headings[0]!.index).trim();

  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i]!;
    const bodyStart = heading.index + heading.length;
    const bodyEnd = i + 1 < headings.length ? headings[i + 1]!.index : normalised.length;
    const body = normalised.slice(bodyStart, bodyEnd).trim();

    if (!body) continue;

    const wordCount = countWords(body);
    if (wordCount < MIN_WORDS && sections.length > 0) {
      // Too small to stand alone: fold it into the previous section.
      const previous = sections[sections.length - 1]!;
      previous.bodyHtml += `\n<h3>${escapeHtml(heading.title)}</h3>\n${paragraphsToHtml(body)}`;
      previous.wordCount += wordCount;
      continue;
    }

    sections.push({
      title: heading.title.slice(0, 180),
      bodyHtml: paragraphsToHtml(body),
      wordCount,
    });
  }

  if (sections.length === 0) return chunkByWords(normalised, fallbackTitle);

  // Preface material (title page, abstract) becomes its own opening section.
  if (preamble && countWords(preamble) >= MIN_WORDS) {
    sections.unshift({
      title: fallbackTitle,
      bodyHtml: paragraphsToHtml(preamble),
      wordCount: countWords(preamble),
    });
  }

  return sections;
}

const HTML_HEADING = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Split DOCX-converted HTML on its own headings.
 *
 * `mammoth` maps Word's built-in styles to h1–h3, so this preserves the author's
 * structure instead of guessing from text. Documents without headings fall back
 * to the plain-text splitter.
 */
export function splitHtmlByHeadings(html: string, fallbackTitle: string): ExtractedSection[] {
  const matches = [...html.matchAll(HTML_HEADING)];
  if (matches.length < 2) {
    return splitPlainText(stripTags(html).replace(/ ([A-Z])/g, ' $1'), fallbackTitle);
  }

  const sections: ExtractedSection[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    const bodyStart = match.index! + match[0].length;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1]!.index! : html.length;
    const body = html.slice(bodyStart, bodyEnd).trim();
    const title = stripTags(match[2] ?? '').slice(0, 180) || fallbackTitle;
    const wordCount = countWords(stripTags(body));

    if (wordCount === 0) continue;

    if (wordCount < MIN_WORDS && sections.length > 0) {
      const previous = sections[sections.length - 1]!;
      previous.bodyHtml += `\n<h3>${escapeHtml(title)}</h3>\n${body}`;
      previous.wordCount += wordCount;
      continue;
    }

    sections.push({ title, bodyHtml: body, wordCount });
  }

  return sections.length > 0 ? sections : splitPlainText(stripTags(html), fallbackTitle);
}
