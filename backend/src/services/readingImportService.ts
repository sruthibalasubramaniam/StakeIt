/**
 * Import a document into reading sections.
 *
 * Flow: extract text → split into sections → persist as drafts → optionally let
 * the AI draft a knowledge check per section → leave the lesson unpublished so an
 * instructor reviews before learners see anything.
 *
 * Two deliberate behaviours:
 *  - **A scan has no text layer, so nothing is invented.** The file is kept as an
 *    attachment on the lesson and no sections are created; the caller is told why.
 *  - **Importing into a published lesson unpublishes it.** Adding sections changes
 *    what "complete" means, so the lesson must be re-reviewed and re-published.
 */
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { prisma, withTransaction } from '../lib/prisma';
import { badRequest, unprocessable } from '../lib/errors';
import { READING_LIMITS } from '../config/constants';
import { sanitizeReadingHtml } from '../lib/richText';
import { isAiConfigured } from '../lib/ai';
import { isStorageConfigured, uploadObject } from '../lib/storage';
import {
  countWords,
  detectDocumentKind,
  splitHtmlByHeadings,
  splitPlainText,
  type ExtractedSection,
} from '../lib/documentImport';
import { ReadingService } from './readingService';
import { AiReadingService } from './aiReadingService';

/** Below this much text we treat a document as un-extractable (i.e. a scan). */
const MIN_EXTRACTABLE_CHARS = 200;
/** AI drafts cost a call per section, so imports only draft a handful. */
const MAX_AI_SECTIONS = 3;

export interface ImportResult {
  mode: 'SECTIONS' | 'ATTACHMENT_ONLY';
  sectionsCreated: number;
  checkpointsCreated: number;
  resourceId: string | null;
  message: string;
  sections: Array<{ id: string; title: string; wordCount: number }>;
}

function titleFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'Imported reading';
}

async function extract(
  buffer: Buffer,
  kind: ReturnType<typeof detectDocumentKind>,
  fileName: string,
): Promise<{ text: string; sections: ExtractedSection[] }> {
  const fallback = titleFromFile(fileName);

  if (kind === 'PDF') {
    const parsed = await pdfParse(buffer);
    const text = (parsed.text ?? '').replace(/\r\n?/g, '\n');
    return { text, sections: splitPlainText(text, fallback) };
  }

  if (kind === 'DOCX') {
    const [html, raw] = await Promise.all([
      mammoth.convertToHtml({ buffer }),
      mammoth.extractRawText({ buffer }),
    ]);
    const text = raw.value ?? '';
    return { text, sections: splitHtmlByHeadings(html.value ?? '', fallback) };
  }

  if (kind === 'MARKDOWN' || kind === 'TEXT') {
    const text = buffer.toString('utf8');
    return { text, sections: splitPlainText(text, fallback) };
  }

  throw badRequest('Unsupported document type. Upload a PDF, DOCX, Markdown or plain text file.');
}

export const ReadingImportService = {
  async importDocument(
    contentId: string,
    actorId: string,
    role: string,
    input: { buffer: Buffer; fileName: string; mimeType: string; generateCheckpoints: boolean },
  ): Promise<ImportResult> {
    // Ownership + type check reuse the authoring guard.
    const { content } = await ReadingService.loadForAuthoring(contentId, actorId, role);
    if (content.type !== 'READING') throw badRequest('Only reading lessons can import documents.');

    const kind = detectDocumentKind(input.buffer, input.fileName);

    let extracted: { text: string; sections: ExtractedSection[] };
    try {
      extracted = await extract(input.buffer, kind, input.fileName);
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) throw error;
      throw unprocessable('That document could not be read. It may be password-protected or corrupt.', 'VALIDATION_ERROR', {
        reason: 'EXTRACTION_FAILED',
      });
    }

    const text = extracted.text.trim();
    const existing = await prisma.readingSection.count({ where: { contentId } });

    /* ---------------------------------------------------------------- *
     * No text layer: keep the file, create nothing.
     * ---------------------------------------------------------------- */
    if (text.length < MIN_EXTRACTABLE_CHARS) {
      if (!isStorageConfigured()) {
        throw unprocessable(
          'This document has no extractable text (it looks like a scan), and file storage is not configured, so it cannot be kept as an attachment either.',
          'VALIDATION_ERROR',
          { reason: 'NO_TEXT_LAYER' },
        );
      }

      const parentModule = await prisma.module.findUnique({
        where: { id: content.moduleId },
        select: { courseId: true },
      });
      const objectPath = `courses/${parentModule?.courseId ?? 'unknown'}/reading/${contentId}/import-${Date.now()}.pdf`;
      await uploadObject({
        objectPath,
        body: input.buffer,
        contentType: input.mimeType || 'application/pdf',
      });
      const resource = await prisma.readingResource.create({
        data: {
          contentId,
          kind: 'PDF',
          title: titleFromFile(input.fileName),
          storagePath: objectPath,
          fileName: input.fileName,
          mimeType: input.mimeType || 'application/pdf',
          sizeBytes: input.buffer.length,
          orderIndex: await prisma.readingResource.count({ where: { contentId } }),
          extractedText: text || null,
        },
      });

      return {
        mode: 'ATTACHMENT_ONLY',
        sectionsCreated: 0,
        checkpointsCreated: 0,
        resourceId: resource.id,
        message:
          'No text could be extracted — this looks like a scanned document. It was attached to the lesson instead; add sections manually or upload a text-based version.',
        sections: [],
      };
    }

    /* ---------------------------------------------------------------- *
     * Build sections (drafts).
     * ---------------------------------------------------------------- */
    const capacity = Math.max(0, READING_LIMITS.maxSections - existing);
    const prepared = extracted.sections
      .map((section) => {
        const bodyHtml = sanitizeReadingHtml(section.bodyHtml);
        const words = countWords(bodyHtml.replace(/<[^>]+>/g, ' '));
        return { title: section.title.trim(), bodyHtml, words };
      })
      .filter((section) => section.title && section.words > 0)
      .slice(0, capacity);

    if (prepared.length === 0) {
      throw unprocessable(
        capacity === 0
          ? `This lesson already has the maximum of ${READING_LIMITS.maxSections} sections.`
          : 'No readable content was found in that document.',
        'VALIDATION_ERROR',
        { reason: capacity === 0 ? 'SECTION_LIMIT' : 'NO_CONTENT' },
      );
    }

    const created = await withTransaction(async (tx) => {
      const rows: Array<{ id: string; title: string; wordCount: number }> = [];
      let orderIndex = existing;

      for (const section of prepared) {
        const row = await tx.readingSection.create({
          data: {
            contentId,
            title: section.title.slice(0, 200),
            bodyHtml: section.bodyHtml,
            orderIndex,
            estimatedMinutes: Math.max(1, Math.round(section.words / 200)),
          },
        });
        rows.push({ id: row.id, title: row.title, wordCount: section.words });
        orderIndex += 1;
      }

      // Adding content changes completion semantics: force a re-review.
      await tx.moduleContent.update({
        where: { id: contentId },
        data: { readingPublishedAt: null, readingVersion: { increment: 1 } },
      });

      return rows;
    });

    /* ---------------------------------------------------------------- *
     * Optional AI knowledge checks — best effort, never fatal.
     * ---------------------------------------------------------------- */
    let checkpointsCreated = 0;
    if (input.generateCheckpoints && isAiConfigured()) {
      for (const section of created.slice(0, MAX_AI_SECTIONS)) {
        try {
          const draft = await AiReadingService.draftQuestions(contentId, section.id, actorId, role, 2);
          if (draft.questions.length === 0) continue;

          await ReadingService.upsertCheckpoint(contentId, section.id, actorId, role, {
            title: `Knowledge check — ${section.title}`.slice(0, 200),
            prompt: null,
            passingScore: 100,
            maxAttempts: null,
            questions: draft.questions.map((question) => ({
              type: 'SINGLE_CHOICE' as const,
              prompt: question.prompt,
              explanation: question.explanation,
              points: 1,
              options: question.options.map((option) => ({
                label: option.label,
                isCorrect: option.isCorrect,
              })),
            })),
          });
          checkpointsCreated += 1;
        } catch {
          // A failed draft must not lose the import.
        }
      }
    }

    return {
      mode: 'SECTIONS',
      sectionsCreated: created.length,
      checkpointsCreated,
      resourceId: null,
      message:
        `Created ${created.length} section(s)` +
        (checkpointsCreated > 0
          ? ` and ${checkpointsCreated} AI-drafted knowledge check(s) — review them, then publish.`
          : '. Review the wording, add knowledge checks, then publish.'),
      sections: created,
    };
  },
};
