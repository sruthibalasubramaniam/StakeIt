import { describe, expect, it } from 'vitest';
import { countWords, detectDocumentKind, splitHtmlByHeadings, splitPlainText } from '../../src/lib/documentImport';

/**
 * Document splitting.
 *
 * These assertions encode the behaviour an instructor would notice: headings
 * become sections, a document without headings still produces sections, and a
 * document with no text produces none (so the caller attaches it instead).
 */
describe('detectDocumentKind', () => {
  it('trusts magic bytes over the extension', () => {
    expect(detectDocumentKind(Buffer.from('%PDF-1.7 ...'), 'notes.txt')).toBe('PDF');
    expect(detectDocumentKind(Buffer.from('PK\u0003\u0004rest'), 'syllabus.pdf')).toBe('DOCX');
  });

  it('falls back to the extension for text formats', () => {
    expect(detectDocumentKind(Buffer.from('# hello'), 'unit.md')).toBe('MARKDOWN');
    expect(detectDocumentKind(Buffer.from('plain'), 'notes.txt')).toBe('TEXT');
    expect(detectDocumentKind(Buffer.from('x'), 'slides.key')).toBe('UNSUPPORTED');
  });
});

describe('splitPlainText', () => {
  const markdown = [
    '# First Teaching',
    '',
    'A second is a unit of duration. It is defined by counting transitions of a caesium atom,',
    'which is why it does not drift with the rotation of the Earth over long periods of time.',
    '',
    '## Second Teaching',
    '',
    'A metre was once a physical bar in a vault. It is now defined by the distance light travels',
    'in a stated fraction of a second, which makes the definition reproducible anywhere.',
    '',
    '### Third Teaching',
    '',
    'A kilogram was the last artefact-based base unit. It is now tied to the Planck constant,',
    'so the standard can be realised in any sufficiently equipped laboratory on the planet.',
  ].join('\n');

  it('splits markdown on its headings and keeps the titles', () => {
    const sections = splitPlainText(markdown, 'Units');
    expect(sections.map((section) => section.title)).toEqual([
      'First Teaching',
      'Second Teaching',
      'Third Teaching',
    ]);
    expect(sections[0]!.bodyHtml.startsWith('<p>')).toBe(true);
  });

  it('chunks a document with no headings instead of returning one huge section', () => {
    const body = Array.from({ length: 1800 }, (_, index) => 'word' + index).join(' ');
    const sections = splitPlainText(body, 'Long read');
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0]!.title).toBe('Long read');
    expect(sections[1]!.title).toContain('continued');
    // Every word survives the split.
    const total = sections.reduce((sum, section) => sum + section.wordCount, 0);
    expect(total).toBe(1800);
  });

  it('returns nothing for a document with no text, so the caller attaches it', () => {
    expect(splitPlainText('   \n\n  ', 'Scan')).toEqual([]);
  });

  it('unescapes nothing but escapes html metacharacters', () => {
    const [section] = splitPlainText('## Intro\n\nUse 5 < 6 and a & b in prose, which is normal.', 'Doc');
    expect(section!.bodyHtml).toContain('&lt;');
    expect(section!.bodyHtml).toContain('&amp;');
  });
});

describe('splitHtmlByHeadings', () => {
  it('uses mammoth headings as section boundaries', () => {
    const html =
      '<h1>Alpha</h1><p>' + 'alpha '.repeat(30) + '</p>' +
      '<h2>Beta</h2><p>' + 'beta '.repeat(30) + '</p>';
    const sections = splitHtmlByHeadings(html, 'Doc');
    expect(sections.map((section) => section.title)).toEqual(['Alpha', 'Beta']);
  });

  it('falls back to text splitting when a DOCX has no headings', () => {
    const html = '<p>' + 'word '.repeat(40) + '</p>';
    const sections = splitHtmlByHeadings(html, 'No headings');
    expect(sections.length).toBe(1);
    expect(sections[0]!.title).toBe('No headings');
  });
});

describe('countWords', () => {
  it('counts tokens in plain text (callers strip markup first)', () => {
    expect(countWords('one   two')).toBe(2);
    expect(countWords('  spaced   out   words ')).toBe(3);
  });
});
