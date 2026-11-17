import type { SongResult } from '@/types/music';

import { playbackMediaUrl } from '../../shared/localMedia';
import {
  PLAYBACK_LOG_CHANNEL,
  PLAYBACK_MEDIA_CHANNEL,
  type PlaybackLogData,
  type PlaybackLogTrack
} from '../../shared/playbackLog';

export { playbackErrorFields } from '../../shared/playbackLog';

export function logPlayback(event: string, data: PlaybackLogData = {}): void {
  try {
    const now = performance.now();
    window.electron?.ipcRenderer.send(PLAYBACK_LOG_CHANNEL, event, {
      ...data,
      rendererTimeMs: Math.round(now),
      rendererEpochMs: Math.round(performance.timeOrigin + now),
      pageVisibility: document.visibilityState,
      windowFocused: document.hasFocus()
    });
  } catch {
    // 窗口关闭或 IPC 不可用时，诊断日志不应中断播放。
  }
}

// Only the main process sees the source so it can match it to Chromium's media request.
// The persisted record contains a session-scoped key.
export function bindPlaybackMedia(
  requestId: string | undefined,
  audioAttempt: number | undefined,
  requestedUrl: string,
  loadedUrl?: string
): void {
  try {
    window.electron?.ipcRenderer.send(
      PLAYBACK_MEDIA_CHANNEL,
      requestId,
      audioAttempt,
      playbackMediaUrl(requestedUrl),
      loadedUrl ? playbackMediaUrl(loadedUrl) : undefined
    );
  } catch {
    // Media playback must work without diagnostic IPC.
  }
}

export function logTrack(song?: SongResult | null): PlaybackLogTrack | undefined {
  if (!song?.id) return undefined;

  return {
    id: typeof song.id === 'number' || /^[\w-]{1,100}$/.test(song.id) ? song.id : undefined,
    name: typeof song.name === 'string' ? song.name.slice(0, 160) : undefined,
    source: song.source
  };
}

export function audioSourceKind(url?: unknown): string {
  if (!url) return 'missing';
  if (typeof url !== 'string') return 'other';
  if (url.startsWith('local://')) return 'local';
  if (url.startsWith('file:')) return 'file';
  if (/^https?:\/\//i.test(url)) return 'network';
  return 'other';
}
