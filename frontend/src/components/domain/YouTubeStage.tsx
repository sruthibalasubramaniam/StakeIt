import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '../ui/data';

/**
 * YouTube lesson stage.
 *
 * A YouTube *page* is HTML, so it can never be played by a `<video>` element —
 * an instructor pasting a normal YouTube link is exactly the case that used to
 * render as "video source unavailable". This component embeds the official
 * IFrame player instead.
 *
 * The embedded player is driven through the YouTube IFrame API rather than being
 * a decorative frame, because the platform's valid-watch rule needs the real
 * playhead: every 5 seconds of playback the player reports the segment it
 * actually played, in the same shape `<video>` reports. The server trims any
 * segment that claims more progress than wall-clock time allows, so scrubbing to
 * the end still earns nothing.
 *
 * The player keeps its own native controls (play/pause/seek/speed/fullscreen), so
 * no overlay is drawn on top of it.
 */

interface YouTubePlayerLike {
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlaybackRate: () => number;
  destroy: () => void;
}

interface YouTubePlayerEventLike {
  target: YouTubePlayerLike;
  data: number;
}

interface YouTubePlayerOptionsLike {
  videoId: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YouTubePlayerEventLike) => void;
    onStateChange?: (event: YouTubePlayerEventLike) => void;
    onError?: (event: YouTubePlayerEventLike) => void;
  };
}

interface YouTubeApiLike {
  Player: new (element: HTMLElement, options: YouTubePlayerOptionsLike) => YouTubePlayerLike;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

declare global {
  interface Window {
    YT?: YouTubeApiLike;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const SCRIPT_MARKER = 'stakeitYoutubeApi';
const SCRIPT_SELECTOR = 'script[data-stakeit-youtube-api]';

let apiPromise: Promise<YouTubeApiLike> | null = null;

/**
 * Loads `https://www.youtube.com/iframe_api` exactly once per page, no matter
 * how many lesson videos are mounted. Concurrent callers share one promise.
 */
function loadYouTubeApi(): Promise<YouTubeApiLike> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeApiLike>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('The YouTube player API loaded without a YT namespace.'));
    };

    // The API reuses a single global callback, so an already-injected script tag
    // must NOT be duplicated — the callback above will still fire for it.
    if (document.querySelector(SCRIPT_SELECTOR)) return;

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.dataset[SCRIPT_MARKER] = 'true';
    script.onerror = () => reject(new Error('Could not reach the YouTube player API.'));
    document.head.appendChild(script);
  });

  return apiPromise;
}

export function YouTubeStage({
  videoId,
  startSeconds,
  title,
  onHeartbeat,
  onDurationKnown,
}: {
  videoId: string;
  startSeconds: number;
  title: string;
  onHeartbeat: (payload: {
    fromSeconds: number;
    positionSeconds: number;
    elapsedRealSeconds: number;
    durationSeconds: number;
    playbackRate: number;
    activeSeconds: number;
  }) => void;
  onDurationKnown?: (durationSeconds: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerLike | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Callbacks are read through a ref so that the player is created once per
   * video id. Depending on the callback props directly would tear the player
   * down and rebuild it on every parent render (an inline arrow is a new
   * function each time), which would restart the video endlessly.
   */
  const handlersRef = useRef({ onHeartbeat, onDurationKnown });
  handlersRef.current = { onHeartbeat, onDurationKnown };

  /** Playhead bookkeeping for the heartbeat, mirroring the <video> player. */
  const beatRef = useRef({ at: Date.now(), position: 0 });

  const flush = useCallback((realSeconds: number) => {
    const player = playerRef.current;
    if (!player) return;

    // The API requires a positive duration to verify watch progress; before the
    // player is ready `getDuration()` is 0, so there is nothing to report yet.
    const duration = player.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return;

    const position = player.getCurrentTime();
    const previous = beatRef.current;
    const advanced = position - previous.position;
    // Ignore tiny/paused deltas so we don't spam the API.
    if (advanced <= 0.5 && realSeconds < 20) return;

    handlersRef.current.onHeartbeat({
      fromSeconds: previous.position,
      positionSeconds: position,
      elapsedRealSeconds: Math.max(1, Math.round(realSeconds)),
      durationSeconds: Math.round(duration),
      playbackRate: player.getPlaybackRate() || 1,
      activeSeconds: Math.round(realSeconds),
    });

    beatRef.current = { at: Date.now(), position };
  }, []);

  // --- create the embedded player ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let created: YouTubePlayerLike | null = null;

    void loadYouTubeApi()
      .then((api) => {
        const target = containerRef.current;
        if (cancelled || !target) return;

        created = new api.Player(target, {
          videoId,
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            ...(startSeconds > 0 ? { start: startSeconds } : {}),
          },
          events: {
            onReady: (event) => {
              const duration = event.target.getDuration();
              if (Number.isFinite(duration) && duration > 0) {
                handlersRef.current.onDurationKnown?.(duration);
              }
              beatRef.current = { at: Date.now(), position: event.target.getCurrentTime() };
            },
            onStateChange: (event) => {
              const state = api.PlayerState;
              if (event.data === state.PLAYING) {
                // A new playback run resumes from the current playhead.
                beatRef.current = { at: Date.now(), position: event.target.getCurrentTime() };
                const duration = event.target.getDuration();
                if (Number.isFinite(duration) && duration > 0) {
                  handlersRef.current.onDurationKnown?.(duration);
                }
                setPlaying(true);
                return;
              }

              if (event.data === state.PAUSED || event.data === state.ENDED) {
                const previous = beatRef.current;
                flush((Date.now() - previous.at) / 1000);
              }
              setPlaying(false);
            },
            // 2/5/100/101/150 — bad id, unplayable, embedding disabled.
            onError: () => setFailed(true),
          },
        });

        playerRef.current = created;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      // Credit whatever was genuinely watched before the stage goes away.
      const previous = beatRef.current;
      if ((Date.now() - previous.at) / 1000 > 3) flush((Date.now() - previous.at) / 1000);
      playerRef.current = null;
      created?.destroy();
    };
  }, [videoId, startSeconds, flush]);

  // --- heartbeat every 5 seconds while playing ------------------------------
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      flush((Date.now() - beatRef.current.at) / 1000);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [playing, flush]);

  return (
    <div className="flex flex-col gap-space-sm">
      <div className="relative w-full overflow-hidden rounded-xl border border-outline-variant bg-[#283044]">
        <div
          ref={containerRef}
          aria-label={title}
          className="aspect-video w-full [&>iframe]:h-full [&>iframe]:w-full"
        />
      </div>

      {failed ? (
        <Alert tone="warning" title="Video source unavailable">
          This YouTube video could not be loaded — it may have embedding disabled, be private, or the browser blocked the
          request. Watch tracking still applies; an instructor can change the lesson URL at any time.
        </Alert>
      ) : null}
    </div>
  );
}
