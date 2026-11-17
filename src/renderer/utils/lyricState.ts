import type { ILyric } from '@/types/music';

export type LyricStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'failed';
export type LyricFailureReason = NonNullable<ILyric['failureReason']>;
export interface LyricRequestOptions {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}

export const getOnlineLyricId = (id: string | number | undefined): number | null => {
  if (typeof id === 'string' && !/^\d+$/.test(id)) return null;
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
};

export const hasLyricText = (lyric?: ILyric): boolean =>
  Boolean(lyric?.lrcArray?.some((line) => line.text?.trim()));

export const getLyricStatus = (lyric?: ILyric): LyricStatus => {
  if (!lyric) return 'loading';
  if (lyric.loadState === 'failed') return 'failed';
  return hasLyricText(lyric) ? 'ready' : 'empty';
};

export const emptyLyric = (): ILyric => ({
  lrcArray: [],
  lrcTimeArray: [],
  hasWordByWord: false,
  loadState: 'empty'
});

export const failedLyric = (
  failureReason: LyricFailureReason,
  retryable = failureReason === 'network' || failureReason === 'timeout'
): ILyric => ({
  ...emptyLyric(),
  loadState: 'failed',
  failureReason,
  retryable
});

export class LyricLoadError extends Error {
  constructor(
    public readonly reason: LyricFailureReason,
    public readonly retryable = false
  ) {
    super(`Lyric loading failed: ${reason}`);
    this.name = 'LyricLoadError';
  }
}

export const lyricFailureReason = (error: unknown): LyricFailureReason => {
  if (error instanceof LyricLoadError) return error.reason;
  if ((error as { response?: { status?: number } } | undefined)?.response?.status)
    return 'response';
  const code = (error as { code?: string; name?: string } | undefined)?.code;
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT' ? 'timeout' : 'network';
};

export const isTransientLyricStatus = (status: unknown): boolean =>
  typeof status === 'number' &&
  (status === 408 || status === 429 || (status >= 500 && status <= 599));

export const isRetryableLyricError = (error: unknown): boolean => {
  if (error instanceof LyricLoadError) return error.retryable;
  const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
  return status ? isTransientLyricStatus(status) : true;
};

// A successful empty response differs from an error payload or missing response body.
export const isLyricResponse = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const data = value as {
    code?: number;
    lrc?: { lyric?: unknown };
    yrc?: { lyric?: unknown };
    nolyric?: boolean;
    uncollected?: boolean;
    pureMusic?: boolean;
  };
  return (
    (data.code == null || data.code === 200) &&
    (typeof data.lrc?.lyric === 'string' ||
      typeof data.yrc?.lyric === 'string' ||
      data.nolyric === true ||
      data.uncollected === true ||
      data.pureMusic === true)
  );
};
