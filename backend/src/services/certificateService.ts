/**
 * Course certificates.
 *
 * Decisions worth knowing:
 *
 *  - **The PDF is rendered on demand, not stored.** Every field it needs is in
 *    the `certificates` row, so bytes are produced per download instead of being
 *    duplicated into object storage. Nothing to orphan, nothing to sign, and a
 *    revoked certificate simply stops rendering.
 *  - **Eligibility is re-checked here**, never trusted from the client. A
 *    certificate can only be issued for an attempt that the platform itself
 *    marked `COMPLETED`, and only to the learner who owns it.
 *  - **Issuing is idempotent** — `attemptId` is unique, so a double-click or a
 *    replayed request returns the existing certificate.
 *  - **Names and titles are snapshotted** at issue time, so renaming a course
 *    later cannot silently rewrite an issued document.
 */
import { randomBytes } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Certificate } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';

/** Crockford-ish alphabet: no I, L, O or U, so codes survive being read aloud. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Builds a verification code that is short enough to type and random enough to
 * resist guessing: 32^6 ≈ 1.07 billion combinations per year prefix.
 */
export function generateCertificateCode(year = new Date().getUTCFullYear(), bytes = randomBytes(6)): string {
  let suffix = '';
  for (const byte of bytes) suffix += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `SI-${year}-${suffix}`;
}

/**
 * pdf-lib's standard fonts are WinAnsi-encoded, so a name containing Cyrillic,
 * CJK or emoji throws. Rather than fail the download, unsupported characters are
 * replaced with '?' — visible enough that it is worth fixing the name, but never
 * a crashed request.
 */
export function toPdfText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    // The `u` flag matters: without it an emoji is two surrogate halves and
    // becomes '??' instead of a single placeholder.
    .replace(/[^\x20-\x7E\xA0-\xFF]/gu, '?')
    .trim();
}

interface CertificateData {
  code: string;
  learnerName: string;
  courseTitle: string;
  issuer: string;
  completionDate: Date;
  issuedAt: Date;
}

const formatDate = (date: Date): string =>
  date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Draws the certificate. Pure: same data in, same bytes out. */
export async function renderCertificatePdf(data: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificate — ${toPdfText(data.courseTitle)}`);
  doc.setAuthor(toPdfText(data.issuer));
  doc.setSubject(`Certificate of completion for ${toPdfText(data.courseTitle)}`);
  doc.setProducer('Stake It');
  doc.setCreationDate(data.issuedAt);

  const page = doc.addPage([842, 595]);
  const { width, height } = page.getSize();

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);

  const ink = rgb(0.1, 0.11, 0.13);
  const muted = rgb(0.42, 0.45, 0.5);
  const accent = rgb(0.27, 0.15, 0.63);

  // Outer rule + accent corner
  page.drawRectangle({
    x: 28,
    y: 28,
    width: width - 56,
    height: height - 56,
    borderColor: accent,
    borderWidth: 1.2,
  });
  page.drawRectangle({ x: 28, y: height - 44, width: width - 56, height: 16, color: accent });

  const centered = (text: string, font: typeof bold, size: number, y: number, color = ink) => {
    const safe = toPdfText(text);
    page.drawText(safe, {
      x: (width - font.widthOfTextAtSize(safe, size)) / 2,
      y,
      size,
      font,
      color,
    });
  };

  centered('CERTIFICATE OF COMPLETION', bold, 11, height - 92, muted);
  centered('This is to certify that', regular, 13, height - 168);
  centered(data.learnerName, serif, 34, height - 222, ink);

  page.drawLine({
    start: { x: width / 2 - 190, y: height - 240 },
    end: { x: width / 2 + 190, y: height - 240 },
    thickness: 0.8,
    color: rgb(0.85, 0.86, 0.88),
  });

  centered('has successfully completed', regular, 13, height - 272);
  centered(data.courseTitle, bold, 20, height - 312, ink);
  centered(`on ${formatDate(data.completionDate)}`, regular, 12, height - 344, muted);

  /*
   * Footer carries the issuer only. No verification URL and no certificate code
   * is printed: a URL baked into a PDF goes stale the moment the app moves, and
   * the code was removed on request. The code still exists in the database, in
   * the API and on the learner's certificate card — it just is not on the paper.
   */
  page.drawText(toPdfText(data.issuer), { x: 60, y: 96, size: 11, font: bold, color: ink });
  page.drawText('Issued by', { x: 60, y: 110, size: 9, font: regular, color: muted });

  return doc.save();
}

export interface CertificateView {
  code: string;
  learnerName: string;
  courseTitle: string;
  issuer: string;
  completionDate: Date;
  issuedAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  verifyUrl: string;
}

const toView = (certificate: Certificate): CertificateView => ({
  code: certificate.code,
  learnerName: certificate.learnerName,
  courseTitle: certificate.courseTitle,
  issuer: certificate.issuer,
  completionDate: certificate.completionDate,
  issuedAt: certificate.issuedAt,
  revokedAt: certificate.revokedAt,
  revokedReason: certificate.revokedReason,
  verifyUrl: `${env.APP_URL}/verify/${certificate.code}`,
});

export const CertificateService = {
  /** Certificate for an attempt, or `null`. Owner-scoped. */
  async forAttempt(attemptId: string, userId: string): Promise<CertificateView | null> {
    const attempt = await prisma.courseAttempt.findUnique({
      where: { id: attemptId },
      select: { userId: true },
    });
    if (!attempt) throw notFound('Attempt');
    if (attempt.userId !== userId) throw forbidden('This attempt does not belong to you.');

    const certificate = await prisma.certificate.findUnique({ where: { attemptId } });
    return certificate ? toView(certificate) : null;
  },

  /**
   * Issues (or returns) the certificate for a completed attempt.
   *
   * The eligibility check is the whole point of this endpoint: `status` and
   * `completedAt` are only set by the completion service, so a learner calling
   * this directly cannot mint a certificate for work they have not finished.
   */
  async issue(attemptId: string, userId: string): Promise<CertificateView> {
    const attempt = await prisma.courseAttempt.findUnique({
      where: { id: attemptId },
      include: {
        user: { select: { id: true, fullName: true } },
        course: { select: { id: true, title: true } },
      },
    });
    if (!attempt) throw notFound('Attempt');
    if (attempt.userId !== userId) throw forbidden('This attempt does not belong to you.');
    if (attempt.status !== 'COMPLETED' || !attempt.completedAt) {
      throw unprocessable(
        'A certificate is only available once the course is completed.',
        'INVALID_PROGRESS',
        { attemptStatus: attempt.status },
      );
    }

    const existing = await prisma.certificate.findUnique({ where: { attemptId } });
    if (existing) return toView(existing);

    // Retry on the (vanishingly unlikely) code collision rather than failing.
    for (let attemptCount = 0; attemptCount < 4; attemptCount += 1) {
      try {
        const certificate = await prisma.certificate.create({
          data: {
            code: generateCertificateCode(),
            attemptId,
            userId: attempt.userId,
            courseId: attempt.course.id,
            learnerName: attempt.user.fullName,
            courseTitle: attempt.course.title,
            issuer: env.CERTIFICATE_ISSUER,
            completionDate: attempt.completedAt,
          },
        });
        return toView(certificate);
      } catch (error) {
        const code = (error as { code?: string }).code;
        // P2002 on `attemptId` means a concurrent request already issued it.
        if (code === 'P2002') {
          const raced = await prisma.certificate.findUnique({ where: { attemptId } });
          if (raced) return toView(raced);
        }
        if (attemptCount === 3) throw conflict('Could not issue a certificate. Please retry.');
      }
    }

    throw conflict('Could not issue a certificate. Please retry.');
  },

  /** Renders the PDF for a learner's own certificate. */
  async pdf(attemptId: string, userId: string): Promise<{ bytes: Uint8Array; filename: string }> {
    const attempt = await prisma.courseAttempt.findUnique({ where: { id: attemptId }, select: { userId: true } });
    if (!attempt) throw notFound('Attempt');
    if (attempt.userId !== userId) throw forbidden('This attempt does not belong to you.');

    const certificate = await prisma.certificate.findUnique({ where: { attemptId } });
    if (!certificate) throw notFound('Certificate');
    if (certificate.revokedAt) throw forbidden('This certificate has been revoked.');

    const bytes = await renderCertificatePdf(certificate);
    return {
      bytes,
      filename: `${certificate.code}.pdf`,
    };
  },

  /** Public verification. Returns a redacted view — no email, no user id. */
  async verify(code: string) {
    const certificate = await prisma.certificate.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!certificate) return { valid: false as const, code: code.trim().toUpperCase() };

    return {
      valid: !certificate.revokedAt,
      code: certificate.code,
      learnerName: certificate.learnerName,
      courseTitle: certificate.courseTitle,
      issuer: certificate.issuer,
      completionDate: certificate.completionDate,
      issuedAt: certificate.issuedAt,
      revoked: Boolean(certificate.revokedAt),
      revokedAt: certificate.revokedAt,
      revokedReason: certificate.revokedReason,
    };
  },

  /** Admin revocation. Idempotent: revoking twice keeps the first reason. */
  async revoke(code: string, adminId: string, reason: string) {
    if (!reason.trim()) throw badRequest('A reason is required to revoke a certificate.');

    const certificate = await prisma.certificate.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!certificate) throw notFound('Certificate');
    if (certificate.revokedAt) return { ...toView(certificate), alreadyRevoked: true };

    const updated = await prisma.certificate.update({
      where: { id: certificate.id },
      data: { revokedAt: new Date(), revokedBy: adminId, revokedReason: reason.trim().slice(0, 300) },
    });
    return { ...toView(updated), alreadyRevoked: false };
  },

  /** All certificates for one learner, newest first. */
  async listForUser(userId: string) {
    const certificates = await prisma.certificate.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
    });
    return certificates.map(toView);
  },
};
