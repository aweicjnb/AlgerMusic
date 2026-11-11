export const PLAYBACK_LOG_CHANNEL = 'playback:log';
export const PLAYBACK_MEDIA_CHANNEL = 'playback:media-source';

export const playbackRequestIdField = (value: unknown): string | undefined =>
  typeof value === 'string' && /^playback_[0-9]{1,16}_[0-9]{1,10}$/.test(value) ? value : undefined;

export interface PlaybackLogTrack {
  id?: number | string;
  name?: string;
  source?: string;
}

export type PlaybackLogData = Record<
  string,
  string | number | boolean | null | undefined | PlaybackLogTrack
>;

// 错误正文、堆栈和 HTTP 请求配置可能包含音源地址或登录信息。
export function playbackErrorFields(error: unknown): PlaybackLogData {
  if (typeof error === 'number') return { errorCode: error };
  if (typeof error === 'string') return { errorType: 'message' };
  if (!error || typeof error !== 'object') return { errorType: typeof error };

  const { name, code, response } = error as {
    name?: unknown;
    code?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };
  return {
    errorType: typeof name === 'string' && /^[a-zA-Z]{1,40}$/.test(name) ? name : 'object',
    errorCode:
      typeof code === 'number' || (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,47}$/.test(code))
        ? code
        : undefined,
    httpStatus: typeof response?.status === 'number' ? response.status : undefined,
    appCode: typeof response?.data?.code === 'number' ? response.data.code : undefined
  };
}
