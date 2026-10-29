/**
 * Supabase Storage for private course assets.
 *
 * Reading PDFs are private course content, so the bucket is expected to be
 * **private**: the API uploads with the service-role key (server-side only) and
 * hands the browser a short-lived signed URL. The service-role key is never sent
 * to the client and no storage credential is exposed by any response.
 *
 * Everything degrades explicitly: when storage is not configured the reading
 * lesson still works, and PDF resources report `available: false` instead of
 * silently 404-ing or leaking a public URL.
 */
import crypto from 'node:crypto';
import { env } from '../config/env';
import { badRequest, serviceUnavailable } from './errors';

function storageBase(): string {
  return `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1`;
}

function apiKey(): string {
  // Service role is required to write objects and to sign private ones.
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
}

export function isStorageConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_STORAGE_BUCKET);
}

function assertStorageConfigured(): void {
  if (!isStorageConfigured()) {
    throw serviceUnavailable(
      'File storage is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET to enable PDF uploads.',
      { reason: 'STORAGE_NOT_CONFIGURED' },
    );
  }
}

/** Storage object paths never contain the original file name (path injection). */
export function buildReadingAssetPath(params: {
  courseId: string;
  contentId: string;
  extension?: string;
}): string {
  const extension = (params.extension ?? 'pdf').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'pdf';
  return `courses/${params.courseId}/reading/${params.contentId}/${crypto.randomUUID()}.${extension}`;
}

function encodePath(objectPath: string): string {
  return objectPath
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function storageRequest(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    return await fetch(`${storageBase()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        apikey: apiKey(),
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Uploads a buffer. `upsert` is off: object paths are freshly generated. */
export async function uploadObject(params: {
  objectPath: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  assertStorageConfigured();

  const response = await storageRequest(
    `/object/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}/${encodePath(params.objectPath)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': params.contentType,
        'Cache-Control': 'private, max-age=3600',
        'x-upsert': 'false',
      },
      body: new Uint8Array(params.body),
    },
  );

  if (!response.ok) {
    // Never surface the provider body: it can echo bucket policy details.
    throw serviceUnavailable('The file could not be stored. Please retry in a moment.', {
      reason: 'STORAGE_UPLOAD_FAILED',
      status: response.status,
    });
  }
}

/** Short-lived signed URL for a private object. */
export async function createSignedUrl(objectPath: string, expiresInSeconds?: number): Promise<string> {
  assertStorageConfigured();

  const ttl = expiresInSeconds ?? env.READING_SIGNED_URL_TTL_SECONDS;
  const response = await storageRequest(
    `/object/sign/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}/${encodePath(objectPath)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: ttl }),
    },
  );

  if (!response.ok) {
    throw serviceUnavailable('A secure link for this document could not be created.', {
      reason: 'STORAGE_SIGN_FAILED',
      status: response.status,
    });
  }

  const payload = (await response.json().catch(() => ({}))) as { signedURL?: string };
  if (!payload.signedURL) {
    throw serviceUnavailable('The storage provider returned an unexpected response.', {
      reason: 'STORAGE_SIGN_FAILED',
    });
  }

  // Depending on the project version the provider returns either a path
  // ("/object/sign/...") or an absolute URL.
  if (/^https?:\/\//i.test(payload.signedURL)) return payload.signedURL;
  return `${storageBase()}${payload.signedURL.startsWith('/') ? '' : '/'}${payload.signedURL}`;
}

/** Best-effort delete; a failure must not block deleting the metadata row. */
export async function deleteObject(objectPath: string): Promise<void> {
  if (!isStorageConfigured()) return;
  await storageRequest(`/object/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [objectPath] }),
  }).catch(() => undefined);
}

export interface UploadedPdf {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const PDF_MAGIC = Buffer.from('%PDF-');

/**
 * Validates an uploaded PDF before it is stored.
 *
 * Checks, in order: declared content type, size against `READING_PDF_MAX_MB`,
 * the `%PDF-` magic bytes (a `.pdf` extension is not proof of a PDF), and the
 * presence of the end-of-file marker. File names are reduced to a display-only
 * label so no path traversal can reach the storage key.
 */
export function validatePdfUpload(body: Buffer | undefined, declaredType: string | undefined, rawName: string | undefined): UploadedPdf {
  if (!body || body.length === 0) {
    throw badRequest('Attach a PDF file to upload.');
  }

  const maxBytes = env.READING_PDF_MAX_MB * 1024 * 1024;
  if (body.length > maxBytes) {
    throw badRequest(`The PDF is too large. The maximum size is ${env.READING_PDF_MAX_MB} MB.`, {
      maxBytes,
      receivedBytes: body.length,
    });
  }

  const type = (declaredType ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/pdf') {
    throw badRequest('Only PDF uploads are accepted for reading resources.', { received: type || 'unknown' });
  }

  if (!body.subarray(0, 5).equals(PDF_MAGIC)) {
    throw badRequest('That file is not a valid PDF (missing the %PDF header).');
  }
  if (body.subarray(-1024).toString('latin1').indexOf('%%EOF') === -1) {
    throw badRequest('That PDF appears to be truncated or corrupt.');
  }

  const fallback = 'reading-material.pdf';
  const cleaned = (rawName ?? fallback)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, 180);

  return {
    buffer: body,
    fileName: cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned || 'reading-material'}.pdf`,
    mimeType: 'application/pdf',
  };
}
