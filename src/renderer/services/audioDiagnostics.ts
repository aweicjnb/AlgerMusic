// Passive helpers only: no audio graph changes, timers, capture, resetLatency or playback commands.
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const round = (value: number) => Math.round(value * 1000) / 1000;

export function mediaEventTiming(stamp: number, now: number, timeOrigin: number) {
  const normalized = stamp > 1e12 ? stamp - timeOrigin : stamp;
  const valid = finite(normalized) && normalized > 0 && normalized <= now + 1;
  return {
    eventTimeMs: valid ? round(normalized) : undefined,
    eventEpochMs: valid ? round(timeOrigin + normalized) : undefined,
    eventDispatchDelayMs: valid ? round(Math.max(0, now - normalized)) : undefined
  };
}

interface PlaybackStats {
  underrunDuration?: number;
  underrunEvents?: number;
  totalDuration?: number;
  fallbackFramesDuration?: number;
  fallbackFramesEvents?: number;
  totalFramesDuration?: number;
  averageLatency?: number;
  minimumLatency?: number;
  maximumLatency?: number;
}
export interface DiagnosticAudioContext {
  state: string;
  currentTime: number;
  sampleRate: number;
  baseLatency?: number;
  outputLatency?: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
  playbackStats?: PlaybackStats;
  playoutStats?: PlaybackStats;
}

// Seconds in playbackStats (Web Audio 1.1); milliseconds in the older Chromium playoutStats API.
export function audioOutputSnapshot(
  context: DiagnosticAudioContext | null | undefined,
  now: number
) {
  const result: Record<string, string | number | boolean | undefined> = {};
  if (!context) return result;
  result.audioContextState = context.state;
  result.contextTimeSeconds = finite(context.currentTime) ? round(context.currentTime) : undefined;
  result.contextSampleRate = context.sampleRate;
  result.baseLatencyMs = finite(context.baseLatency)
    ? round(context.baseLatency * 1000)
    : undefined;
  result.outputLatencyMs = finite(context.outputLatency)
    ? round(context.outputLatency * 1000)
    : undefined;
  try {
    const timestamp = context.getOutputTimestamp?.();
    result.outputTimestampSupported = Boolean(timestamp);
    if (
      timestamp &&
      finite(timestamp.performanceTime) &&
      timestamp.performanceTime > 0 &&
      finite(timestamp.contextTime)
    ) {
      result.outputContextTimeSeconds = round(timestamp.contextTime);
      result.outputPerformanceTimeMs = round(timestamp.performanceTime);
      result.outputTimestampAgeMs = round(Math.max(0, now - timestamp.performanceTime));
    }
  } catch {
    result.outputTimestampReadError = true;
  }
  try {
    const modern = context.playbackStats;
    const stats = modern ?? context.playoutStats;
    result.playoutStatsApi = modern ? 'playbackStats' : stats ? 'playoutStats' : 'unavailable';
    if (stats) {
      const scale = modern ? 1000 : 1;
      const duration = modern ? stats.underrunDuration : stats.fallbackFramesDuration;
      const count = modern ? stats.underrunEvents : stats.fallbackFramesEvents;
      const total = modern ? stats.totalDuration : stats.totalFramesDuration;
      result.outputUnderrunMs = finite(duration) ? round(duration * scale) : undefined;
      result.outputUnderrunCount = finite(count) ? count : undefined;
      result.outputTotalDurationMs = finite(total) ? round(total * scale) : undefined;
      result.outputAverageLatencyMs = finite(stats.averageLatency)
        ? round(stats.averageLatency * scale)
        : undefined;
      result.outputMinimumLatencyMs = finite(stats.minimumLatency)
        ? round(stats.minimumLatency * scale)
        : undefined;
      result.outputMaximumLatencyMs = finite(stats.maximumLatency)
        ? round(stats.maximumLatency * scale)
        : undefined;
    }
  } catch {
    result.playoutStatsApi = 'unavailable';
    result.playoutStatsReadError = true;
  }
  return result;
}

export interface AudioClockSample {
  timeMs: number;
  position: number;
  rate: number;
  contextId?: number;
  contextTime?: number;
  outputTime?: number;
  underrunMs?: number;
  underrunCount?: number;
}
export function audioClockDelta(previous: AudioClockSample, current: AudioClockSample) {
  const wallMs = current.timeMs - previous.timeMs;
  const mediaDeltaMs = (current.position - previous.position) * 1000;
  const discontinuity =
    wallMs <= 0 ||
    !finite(current.rate) ||
    current.rate <= 0 ||
    current.rate !== previous.rate ||
    current.contextId !== previous.contextId ||
    mediaDeltaMs < -50 ||
    mediaDeltaMs > wallMs * current.rate + 1000;
  const delta = (a: number | undefined, b: number | undefined, scale: number) =>
    finite(a) && finite(b) ? round((b - a) * scale) : undefined;
  return {
    clockDiscontinuity: discontinuity,
    sampleIntervalMs: round(wallMs),
    mediaDeltaMs: round(mediaDeltaMs),
    mediaShortfallMs: discontinuity
      ? undefined
      : round(Math.max(0, wallMs - mediaDeltaMs / current.rate)),
    contextDeltaMs: discontinuity
      ? undefined
      : delta(previous.contextTime, current.contextTime, 1000),
    outputDeltaMs: discontinuity ? undefined : delta(previous.outputTime, current.outputTime, 1000),
    outputUnderrunDeltaMs: discontinuity
      ? undefined
      : delta(previous.underrunMs, current.underrunMs, 1),
    outputUnderrunDeltaCount: discontinuity
      ? undefined
      : delta(previous.underrunCount, current.underrunCount, 1)
  };
}
