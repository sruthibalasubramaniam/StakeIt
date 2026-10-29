import { describe, expect, it } from 'vitest';
import { generateCertificateCode, renderCertificatePdf, toPdfText } from '../../src/services/certificateService';

/**
 * Certificate primitives.
 *
 * The PDF is generated rather than stored, so these tests are the only proof
 * that a download produces a real document: a valid PDF header, a plausible
 * size, and no crash on awkward names.
 */
describe('generateCertificateCode', () => {
  it('produces SI-<year>-<6 chars> using the unambiguous alphabet', () => {
    const code = generateCertificateCode(2026, Buffer.from([0, 1, 2, 3, 4, 5]));
    expect(code).toMatch(/^SI-2026-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(code.split('-')[2]).not.toMatch(/[ILOU]/);
  });

  it('is stable for given bytes and varies otherwise', () => {
    const a = generateCertificateCode(2026, Buffer.from([9, 9, 9, 9, 9, 9]));
    const b = generateCertificateCode(2026, Buffer.from([9, 9, 9, 9, 9, 9]));
    expect(a).toBe(b);

    const codes = new Set(Array.from({ length: 200 }, () => generateCertificateCode()));
    expect(codes.size).toBeGreaterThan(195);
  });
});

describe('toPdfText', () => {
  it('keeps latin text and normalises typographic punctuation', () => {
    expect(toPdfText('Ada Lovelace')).toBe('Ada Lovelace');
    expect(toPdfText('Stake It\u2019s \u201cbest\u201d course')).toBe('Stake It\'s "best" course');
    expect(toPdfText('R\u00e9sum\u00e9')).toBe('R\u00e9sum\u00e9');
  });

  it('replaces characters the standard fonts cannot encode instead of throwing', () => {
    expect(toPdfText('\u4e2d\u6587 name')).toBe('?? name');
    expect(toPdfText('emoji \u{1f600}')).toBe('emoji ?');
  });
});

describe('renderCertificatePdf', () => {
  const data = {
    code: 'SI-2026-ABC123',
    learnerName: 'Ada Lovelace',
    courseTitle: 'Full-Stack TypeScript & Architecture',
    issuer: 'Stake It Academy',
    completionDate: new Date('2026-10-27T00:00:00Z'),
    issuedAt: new Date('2026-10-27T09:00:00Z'),
  };

  it('produces a real PDF document', async () => {
    const bytes = await renderCertificatePdf(data);
    const header = Buffer.from(bytes.slice(0, 5)).toString('latin1');
    expect(header).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });

  it('does not throw on a name the fonts cannot fully encode', async () => {
    const bytes = await renderCertificatePdf({
      ...data,
      learnerName: '\u5c71\u7530 \u592a\u90ce \u{1f393}',
      courseTitle: '\u8bfe\u7a0b \u2014 Course',
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });
});
