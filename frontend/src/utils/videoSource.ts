/**
 * Lesson video source resolution.
 *
 * Instructors paste whatever they have into the course builder: a YouTube link
 * (watch / share / shorts / embed) or a direct media file (an object-storage URL
 * ending in `.mp4`). Those two need completely different players — a YouTube
 * *page* is HTML, so a `<video>` element cannot play it at all — which is why
 * the URL is classified here instead of being handed straight to the element.
 *
 * Keeping the parsing pure — no React, no DOM — makes the edge cases (share
 * links, shorts, `t=` offsets, signed storage URLs with no extension) cheap to
 * reason about and straightforward to unit test.
 */

export type VideoSource =
  /** A YouTube video: rendered as an embedded iframe player. */
  | { kind: 'youtube'; videoId: string; startSeconds: number }
  /** A direct media file (or any non-YouTube URL): rendered as a <video>. */
  | { kind: 'file'; url: string }
  /** A YouTube URL we could not extract an id from. */
  | { kind: 'unrecognised'; url: string };

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
]);

/** Path prefixes that carry the video id as the following path segment. */
const ID_IN_PATH = ['embed', 'shorts', 'live', 'v'];

function extractYouTubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (host.endsWith('youtu.be')) {
    return segments[0] ?? null;
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    return id ? id : null;
  }

  const [prefix, id] = segments;
  if (prefix && ID_IN_PATH.includes(prefix) && id) {
    return id;
  }

  return null;
}

/**
 * Reads the start offset YouTube itself uses. It appears as `t` on share links
 * (`?t=90`, `?t=1m30s`) and as `start` on embed links.
 */
function extractStartSeconds(url: URL): number {
  const raw = url.searchParams.get('start') ?? url.searchParams.get('t');
  if (!raw) return 0;

  if (/^\d+s?$/.test(raw)) return Number.parseInt(raw, 10);

  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!parts) return 0;
  const [, hours, minutes, seconds] = parts;
  if (!hours && !minutes && !seconds) return 0;

  return (
    Number.parseInt(hours ?? '0', 10) * 3600 +
    Number.parseInt(minutes ?? '0', 10) * 60 +
    Number.parseInt(seconds ?? '0', 10)
  );
}

/**
 * Classifies a lesson URL. Returns `null` when there is no URL at all, so the
 * caller can render an explicit "no video configured" state.
 *
 * Anything that is not a YouTube link is treated as a media file and handed to
 * the native player: signed object-storage URLs (Supabase Storage) work but do
 * not necessarily carry a file extension, so guessing "not a video" from the
 * path would break real content.
 */
export function parseVideoSource(raw: string | null | undefined): VideoSource | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  // Blob and data URLs are always played natively.
  if (/^(blob:|data:)/i.test(value)) return { kind: 'file', url: value };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // A bare string (e.g. an id an instructor typed) is not playable.
    return { kind: 'unrecognised', url: value };
  }

  if (YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    const videoId = extractYouTubeId(url);
    if (!videoId) return { kind: 'unrecognised', url: value };
    return { kind: 'youtube', videoId, startSeconds: extractStartSeconds(url) };
  }

  return { kind: 'file', url: value };
}
