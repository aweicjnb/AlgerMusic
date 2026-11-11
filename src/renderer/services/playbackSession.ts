export type PlaybackPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'failed';
export type PlaybackFailure = 'missing-source' | 'metadata' | 'source' | 'audio';

export interface PlaybackSession {
  requestId: string | null;
  phase: PlaybackPhase;
  wantsPlay: boolean;
  failure: PlaybackFailure | null;
}

export type PlaybackEvent =
  | { type: 'begin'; requestId: string; wantsPlay: boolean }
  | { type: 'intent'; wantsPlay: boolean }
  | { type: 'ready'; requestId: string | null }
  | { type: 'playing'; requestId: string | null }
  | { type: 'paused'; requestId: string | null }
  | { type: 'failed'; requestId: string | null; failure: PlaybackFailure };

export const createPlaybackSession = (): PlaybackSession => ({
  requestId: null,
  phase: 'idle',
  wantsPlay: false,
  failure: null
});

/** One transition point for intent, media events and asynchronous request results. */
export function reducePlaybackSession(
  state: PlaybackSession,
  event: PlaybackEvent
): PlaybackSession {
  if (event.type === 'begin') {
    return {
      requestId: event.requestId,
      phase: 'loading',
      wantsPlay: event.wantsPlay,
      failure: null
    };
  }
  if (event.type === 'intent') {
    if (!event.wantsPlay && state.phase === 'failed') return state;
    return {
      ...state,
      wantsPlay: event.wantsPlay,
      phase: event.wantsPlay
        ? state.phase === 'playing'
          ? 'playing'
          : 'loading'
        : state.phase === 'loading'
          ? 'loading'
          : state.phase === 'idle'
            ? 'idle'
            : 'paused',
      failure: null
    };
  }
  if (event.requestId !== state.requestId) return state;
  if (state.phase === 'failed' && event.type !== 'failed') return state;
  switch (event.type) {
    case 'ready':
      return { ...state, phase: state.wantsPlay ? state.phase : 'paused' };
    case 'playing':
      return state.wantsPlay ? { ...state, phase: 'playing', failure: null } : state;
    case 'paused':
      return { ...state, phase: 'paused', wantsPlay: false };
    case 'failed':
      return { ...state, phase: 'failed', wantsPlay: false, failure: event.failure };
  }
}
