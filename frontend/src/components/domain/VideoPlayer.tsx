import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import { Button, MaterialIcon, ProgressBar } from '../ui/core';
import { Alert } from '../ui/data';
import { formatDuration, formatPercent } from '../../utils/format';
import { parseVideoSource } from '../../utils/videoSource';
import { YouTubeStage } from './YouTubeStage';

export interface VideoProgressState {
  watchedSeconds: number;
  validWatchPercent: number;
  requiredWatchPercent: number;
  isWatchRequirementMet: boolean;
  notice?: string;
  suspicious?: boolean;
}

/**
 * Learning video with valid-watch verification.
 *
 * The player only ever reports *segments it actually played*:
 *  - `fromSeconds` is the playhead when the previous heartbeat was sent
 *  - `elapsedRealSeconds` is the real time that passed
 *  - the server rejects anything faster than physical playback, so scrubbing to
 *    the end cannot satisfy the completion requirement
 *
 * There is no webcam, no focus enforcement and no mouse tracking — the check is
 * deliberately limited to reasonable learning verification.
 */
export function VideoPlayer({
  src,
  title,
  durationSeconds,
  requiredWatchPercent,
  initialState,
  onHeartbeat,
  onComplete,
  canComplete,
  completing,
  className,
}: {
  src: string | null;
  title: string;
  durationSeconds: number;
  requiredWatchPercent: number;
  initialState: VideoProgressState;
  onHeartbeat: (payload: {
    fromSeconds: number;
    positionSeconds: number;
    elapsedRealSeconds: number;
    durationSeconds: number;
    playbackRate: number;
    activeSeconds: number;
  }) => void;
  onComplete: () => void;
  canComplete: boolean;
  completing: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastHeartbeatRef = useRef<{ at: number; position: number; realSeconds: number }>({
    at: Date.now(),
    position: initialState.watchedSeconds > 0 ? Number(initialState.watchedSeconds) : 0,
    realSeconds: 0,
  });

  const [progress, setProgress] = useState<VideoProgressState>(initialState);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(durationSeconds);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    setProgress(initialState);
  }, [initialState]);

  const flush = useCallback(
    (realSeconds: number) => {
      const video = videoRef.current;
      const currentDuration = video?.duration && Number.isFinite(video.duration) ? video.duration : durationSeconds;
      const currentPosition = video?.currentTime ?? position;
      const previous = lastHeartbeatRef.current;

      const advanced = currentPosition - previous.position;
      // Ignore tiny/paused deltas so we don't spam the API.
      if (advanced <= 0.5 && realSeconds < 20) return;

      onHeartbeat({
        fromSeconds: previous.position,
        positionSeconds: currentPosition,
        elapsedRealSeconds: Math.max(1, Math.round(realSeconds)),
        durationSeconds: Math.round(currentDuration),
        playbackRate: video?.playbackRate ?? 1,
        activeSeconds: Math.round(realSeconds),
      });

      lastHeartbeatRef.current = { at: Date.now(), position: currentPosition, realSeconds: 0 };
    },
    [durationSeconds, onHeartbeat, position],
  );

  // Heartbeat every 5 seconds while playing.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const previous = lastHeartbeatRef.current;
      const realSeconds = (Date.now() - previous.at) / 1000;
      flush(realSeconds);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [playing, flush]);

  // Send a final heartbeat when the tab is hidden or the component unmounts.
  useEffect(() => {
    return () => {
      const previous = lastHeartbeatRef.current;
      const realSeconds = (Date.now() - previous.at) / 1000;
      if (realSeconds > 3) flush(realSeconds);
    };
  }, [flush]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      // New playback run starts from wherever the playhead sits.
      lastHeartbeatRef.current = { at: Date.now(), position: video.currentTime, realSeconds: 0 };
      void video.play().catch(() => setLoadError(true));
    } else {
      const previous = lastHeartbeatRef.current;
      flush((Date.now() - previous.at) / 1000);
      video.pause();
    }
  };

  const handleSeek = () => {
    const video = videoRef.current;
    if (!video) return;
    const previous = lastHeartbeatRef.current;
    // Credit whatever was genuinely watched before the jump, then restart the
    // clock — simply skipping ahead earns nothing.
    if (!video.paused) flush((Date.now() - previous.at) / 1000);
    lastHeartbeatRef.current = { at: Date.now(), position: video.currentTime, realSeconds: 0 };
    setNotice('Scrubbing ahead does not credit completion time.');
  };

  const source = parseVideoSource(src);

  const met = progress.isWatchRequirementMet;
  const watchedPercent = progress.validWatchPercent;

  /*
   * YouTube links are embedded; everything else is handed to the native element.
   * See `utils/videoSource.ts` — a YouTube page is HTML, so a <video> can never
   * play it, which is exactly why an instructor-supplied YouTube URL used to
   * render as "source unavailable" instead of the lesson.
   */
  const youtube = source?.kind === 'youtube' ? source : null;

  return (
    <div className={cn('flex flex-col gap-space-md', className)}>
      {youtube ? (
        <YouTubeStage
          videoId={youtube.videoId}
          startSeconds={youtube.startSeconds}
          title={title}
          onHeartbeat={onHeartbeat}
          onDurationKnown={(seconds) => setDuration(seconds)}
        />
      ) : (
        <div className="relative w-full overflow-hidden rounded-xl border border-outline-variant bg-[#283044]">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            src={src ?? undefined}
            className="aspect-video w-full bg-[#283044]"
            preload="metadata"
            muted={muted}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value) && value > 0) setDuration(value);
            }}
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeking={handleSeek}
            onEnded={() => {
              setPlaying(false);
              const previous = lastHeartbeatRef.current;
              flush((Date.now() - previous.at) / 1000);
            }}
            onError={() => setLoadError(true)}
          />
  
          {!playing ? (
            <button
              type="button"
              onClick={togglePlay}
              aria-label={position > 0 ? 'Resume video' : 'Play video'}
              className="absolute inset-0 flex flex-col items-center justify-center gap-space-md bg-[#283044]/40 transition-colors hover:bg-[#283044]/20"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-container">
                <MaterialIcon name="play_arrow" filled className="text-[28px] text-on-primary" />
              </span>
              <span className="font-label-md text-label-md text-inverse-on-surface">{title}</span>
            </button>
          ) : null}
  
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-space-xs bg-[#283044]/85 px-space-md py-space-sm">
            <div className="h-0.5 w-full bg-white/20">
              <div
                className="h-full bg-primary-container"
                style={{ width: `${duration > 0 ? (position / duration) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-md">
                <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="text-inverse-on-surface">
                  <MaterialIcon name={playing ? 'pause' : 'play_arrow'} filled />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (videoRef.current) videoRef.current.muted = !muted;
                    setMuted((value) => !value);
                  }}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  className="text-inverse-on-surface"
                >
                  <MaterialIcon name={muted ? 'volume_off' : 'volume_up'} />
                </button>
                <span className="font-mono text-label-xs tabular text-inverse-on-surface">
                  {formatDuration(position)} / {formatDuration(duration)}
                </span>
              </div>
              <div className="flex items-center gap-space-md">
                <button
                  type="button"
                  onClick={() => {
                    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
                    if (videoRef.current) videoRef.current.playbackRate = next;
                    setRate(next);
                  }}
                  className="font-mono text-label-xs text-inverse-on-surface"
                  aria-label="Playback speed"
                >
                  {rate.toFixed(1)}x
                </button>
                <button
                  type="button"
                  onClick={() => videoRef.current?.requestFullscreen?.()}
                  aria-label="Fullscreen"
                  className="text-inverse-on-surface"
                >
                  <MaterialIcon name="fullscreen" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-sm">
            <span className={cn('h-1.5 w-1.5 rounded-full', met ? 'bg-secondary' : 'bg-primary-container')} />
            <span className="font-label-sm text-label-sm text-on-surface">
              <span className="metric">{formatPercent(watchedPercent)}</span> watched ({requiredWatchPercent}% required to complete)
            </span>
          </div>
          <span className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
            <MaterialIcon name="lock" className="text-[14px]" />
            Scrubbing ahead does not credit completion time.
          </span>
        </div>

        <ProgressBar value={watchedPercent} tone={met ? 'success' : 'primary'} label="Valid watch progress" />
      </div>

      {loadError ? (
        <Alert tone="warning" title="Video source unavailable">
          This lesson's media file could not be loaded — the URL may be wrong, unreachable from your network, or served without
          CORS headers. Watch tracking still applies: an instructor can repoint the lesson at any public MP4 or a YouTube link.
        </Alert>
      ) : null}

      {notice && !met ? (
        <Alert tone="info" icon="info">
          {notice}
        </Alert>
      ) : null}

      {progress.suspicious && progress.notice ? (
        <Alert tone="warning" title="Playback verification">
          {progress.notice}
        </Alert>
      ) : null}

      <div className="flex items-center justify-between gap-space-md">
        <span className="font-body-sm text-body-sm text-on-surface-variant">
          {met
            ? 'Valid watch requirement met — you can complete this lesson.'
            : `${formatDuration(Math.max(0, (requiredWatchPercent / 100) * duration - progress.watchedSeconds))} of valid watch time remaining.`}
        </span>
        <Button onClick={onComplete} disabled={!canComplete} loading={completing} iconRight="check">
          Mark lesson complete
        </Button>
      </div>
    </div>
  );
}
