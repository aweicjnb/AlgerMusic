type TrackIdentity = { id?: string | number; source?: string } | null | undefined;

/** A refreshed URL or another provider must not reuse an older audio instance. */
export function playbackSourceKey(track: {
  id: string | number;
  source?: string;
  playMusicUrl?: string;
}): string {
  return JSON.stringify([track.source ?? '', track.id, track.playMusicUrl ?? '']);
}

interface PlaybackAttempt {
  requestId?: string;
  currentRequestId: string | null;
  selectedTrack: TrackIdentity;
  audioTrack: TrackIdentity;
  expectedSound: unknown;
  currentSound: unknown;
}

/** Ignore late events from a replaced sound or a superseded song request. */
export function isCurrentPlaybackAttempt(attempt: PlaybackAttempt): boolean {
  const { requestId, currentRequestId, selectedTrack, audioTrack, expectedSound, currentSound } =
    attempt;
  if (!expectedSound || expectedSound !== currentSound) return false;
  if (requestId && requestId !== currentRequestId) return false;
  if (selectedTrack?.id == null || audioTrack?.id !== selectedTrack.id) return false;
  return !selectedTrack.source || !audioTrack.source || selectedTrack.source === audioTrack.source;
}

export type ResumePositionSource = 'source-recovery' | 'saved-progress' | 'beginning';

export function chooseResumePosition(
  trackId: string | number | undefined,
  recoveryPositionSeconds: number | undefined,
  savedProgress: { songId?: string | number; progress?: number } | null | undefined
): { seconds: number; source: ResumePositionSource } {
  if (
    typeof recoveryPositionSeconds === 'number' &&
    Number.isFinite(recoveryPositionSeconds) &&
    recoveryPositionSeconds >= 0
  ) {
    return { seconds: recoveryPositionSeconds, source: 'source-recovery' };
  }
  if (
    trackId != null &&
    savedProgress?.songId === trackId &&
    typeof savedProgress.progress === 'number' &&
    Number.isFinite(savedProgress.progress) &&
    savedProgress.progress >= 0
  ) {
    return { seconds: savedProgress.progress, source: 'saved-progress' };
  }
  return { seconds: 0, source: 'beginning' };
}
