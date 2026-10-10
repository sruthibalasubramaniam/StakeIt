import { describe, expect, it } from 'vitest';
import { courseRefWhere } from '../../src/services/courseService';

/**
 * Courses are addressed as `/courses/:idOrSlug`, and the catalogue only ever has
 * the slug. `Course.id` is a Postgres `uuid` column, so putting a slug in the
 * `id` branch of the filter makes Postgres reject the cast before the `OR` is
 * evaluated — resolving a slug has to skip that branch entirely.
 */
describe('course reference resolution', () => {
  const UUID = 'c1f0a5b2-8e3d-4a7b-9f21-6d4c8b0a1e33';

  type Where = { OR: Array<Record<string, string>> };

  it('matches id, slug and code for a UUID reference', () => {
    expect(courseRefWhere(UUID)).toEqual({ OR: [{ id: UUID }, { slug: UUID }, { code: UUID }] });
  });

  it('never puts a slug in the uuid column branch', () => {
    const where = courseRefWhere('full-stack-typescript-architecture') as Where;
    expect(where.OR.some((clause) => 'id' in clause)).toBe(false);
    expect(where.OR).toEqual([
      { slug: 'full-stack-typescript-architecture' },
      { code: 'full-stack-typescript-architecture' },
    ]);
  });

  it('treats a human course code as a non-uuid reference', () => {
    const where = courseRefWhere('FUL-104') as Where;
    expect(where.OR.some((clause) => 'id' in clause)).toBe(false);
    expect(where.OR).toEqual([{ slug: 'FUL-104' }, { code: 'FUL-104' }]);
  });

  it('trims surrounding whitespace', () => {
    const where = courseRefWhere('  FUL-104  ') as Where;
    expect(where.OR).toEqual([{ slug: 'FUL-104' }, { code: 'FUL-104' }]);
  });

  it('detects the uuid shape case-insensitively', () => {
    const upper = UUID.toUpperCase();
    expect(courseRefWhere(upper)).toEqual({ OR: [{ id: upper }, { slug: upper }, { code: upper }] });
  });

  it('does not mistake a slug for a uuid', () => {
    // A near-miss: right length, wrong alphabet.
    const nearMiss = 'c1f0a5b2-8e3d-4a7b-9f21-6d4c8b0a1e3z';
    const where = courseRefWhere(nearMiss) as Where;
    expect(where.OR.some((clause) => 'id' in clause)).toBe(false);
  });
});
