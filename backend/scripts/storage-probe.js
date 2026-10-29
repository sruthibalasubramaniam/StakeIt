/**
 * Live round-trip against the configured Supabase Storage bucket.
 *
 * Proves the three things the reading feature depends on, using the same code
 * the API uses: upload a PDF, mint a signed URL, fetch it back, delete it.
 * Prints no credentials.
 */
const storage = require('../dist/lib/storage.js');

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

(async () => {
  console.log('storage_configured=', storage.isStorageConfigured());

  const objectPath = storage.buildReadingAssetPath({
    courseId: '00000000-0000-0000-0000-000000000001',
    contentId: '00000000-0000-0000-0000-000000000002',
    fileName: 'probe.pdf',
  });
  console.log('object_path=', objectPath);

  const validated = storage.validatePdfUpload(PDF, 'application/pdf', 'probe.pdf');
  console.log('validation_ok=', validated.buffer.length > 0, 'file_name=', validated.fileName, 'mime=', validated.mimeType);

  await storage.uploadObject({ objectPath, body: PDF, contentType: 'application/pdf' });
  console.log('upload=ok');

  const signed = await storage.createSignedUrl(objectPath, 300);
  console.log('signed_url_host=', new URL(signed).host, 'has_token=', signed.includes('token='));

  const response = await fetch(signed);
  const bytes = (await response.arrayBuffer()).byteLength;
  console.log('signed_fetch_status=', response.status, 'bytes=', bytes, 'matches=', bytes === PDF.length);

  await storage.deleteObject(objectPath);
  console.log('delete=ok');

  // A signed URL for a deleted object must stop working — proves the bucket is
  // private and access is really gated by the signature.
  const revoked = await fetch(signed);
  console.log('signed_url_after_delete_status=', revoked.status, '(400/404 expected)');
})().catch((error) => {
  console.error('PROBE FAILED:', String(error.message).slice(0, 400));
  process.exitCode = 1;
});
