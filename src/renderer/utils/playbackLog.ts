import {
  PLAYBACK_LOG_CHANNEL,
  type PlaybackLogData,
  type PlaybackLogTrack
} from '../../shared/playbackLog';
import type { SongResult } from '@/types/music';

export { playbackErrorFields } from '../../shared/playbackLog';

export function logPlayback(event: string, data: PlaybackLogData = {}): void {
  try {
    window.electron?.ipcRenderer.send(PLAYBACK_LOG_CHANNEL, event, data);
  } catch {
    // 窗口关闭或 IPC 不可用时，诊断日志不应中断播放。
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

export function audioSourceKind(url?: string | null): string {
  if (!url) return 'missing';
  if (url.startsWith('local://')) return 'local';
  if (url.startsWith('file:')) return 'file';
  if (/^https?:\/\//i.test(url)) return 'network';
  return 'other';
}
