import assert from 'node:assert/strict';
import test from 'node:test';

import {
  audioClockDelta,
  audioOutputSnapshot,
  mediaEventTiming
} from '../src/renderer/services/audioDiagnostics.ts';

test('event creation time distinguishes queue delay from callback duration', () => {
  const waiting = mediaEventTiming(100, 750, 1700000000000);
  const playing = mediaEventTiming(740, 751, 1700000000000);
  assert.equal(waiting.eventDispatchDelayMs, 650);
  assert.equal(playing.eventTimeMs - waiting.eventTimeMs, 640);
  assert.equal(waiting.eventEpochMs, 1700000000100);
  assert.equal(mediaEventTiming(1700000000100, 750, 1700000000000).eventTimeMs, 100);
  assert.equal(mediaEventTiming(NaN, 750, 1700000000000).eventTimeMs, undefined);
  assert.equal(mediaEventTiming(9999, 750, 1700000000000).eventTimeMs, undefined);
});

const base = () => ({
  state: 'running',
  currentTime: 10,
  sampleRate: 48000,
  baseLatency: 0.01,
  outputLatency: 0.02,
  getOutputTimestamp: () => ({ contextTime: 9.98, performanceTime: 9900 })
});
test('reads output clocks and converts modern underrun statistics from seconds', () => {
  const context = {
    ...base(),
    playbackStats: {
      underrunDuration: 0.125,
      underrunEvents: 2,
      totalDuration: 10.125,
      averageLatency: 0.02,
      minimumLatency: 0.01,
      maximumLatency: 0.04
    }
  };
  const result = audioOutputSnapshot(context, 10000);
  assert.equal(result.outputUnderrunMs, 125);
  assert.equal(result.outputUnderrunCount, 2);
  assert.equal(result.outputAverageLatencyMs, 20);
  assert.equal(result.outputTimestampAgeMs, 100);
  assert.equal(result.outputContextTimeSeconds, 9.98);
  assert.equal(result.playoutStatsApi, 'playbackStats');
  assert.equal(result.baseLatencyMs, 10);
});
test('older Chromium statistics already use milliseconds; never reset their counters', () => {
  const context = {
    ...base(),
    playoutStats: {
      fallbackFramesDuration: 125,
      fallbackFramesEvents: 2,
      totalFramesDuration: 10125,
      averageLatency: 20,
      resetLatency() {
        throw new Error('Diagnostics must not reset counters');
      }
    }
  };
  const result = audioOutputSnapshot(context, 10000);
  assert.equal(result.outputUnderrunMs, 125);
  assert.equal(result.outputAverageLatencyMs, 20);
  assert.equal(result.playoutStatsApi, 'playoutStats');
});
test('unsupported or throwing optional APIs report unavailability without invented zero counters', () => {
  const unsupported = audioOutputSnapshot(base(), 10000);
  assert.equal(unsupported.playoutStatsApi, 'unavailable');
  assert.equal(unsupported.outputUnderrunMs, undefined);
  const context = {
    ...base(),
    get playbackStats() {
      throw new Error('Unavailable');
    },
    getOutputTimestamp() {
      throw new Error('Unavailable');
    }
  };
  const result = audioOutputSnapshot(context, 10000);
  assert.equal(result.playoutStatsApi, 'unavailable');
  assert.equal(result.outputTimestampReadError, true);
  assert.equal(result.contextTimeSeconds, 10);
});
test('clock comparison measures media/output shortfalls and underrun counter changes', () => {
  const previous = {
    timeMs: 1000,
    position: 10,
    rate: 1,
    contextId: 1,
    contextTime: 20,
    outputTime: 19.9,
    underrunMs: 100,
    underrunCount: 1
  };
  const current = {
    timeMs: 2000,
    position: 10.4,
    rate: 1,
    contextId: 1,
    contextTime: 20.7,
    outputTime: 20.6,
    underrunMs: 400,
    underrunCount: 2
  };
  const result = audioClockDelta(previous, current);
  assert.equal(result.mediaShortfallMs, 600);
  assert.equal(result.contextDeltaMs, 700);
  assert.equal(result.outputDeltaMs, 700);
  assert.equal(result.outputUnderrunDeltaMs, 300);
  assert.equal(result.outputUnderrunDeltaCount, 1);
  assert.equal(audioClockDelta(previous, { ...current, position: 50 }).clockDiscontinuity, true);
  assert.equal(audioClockDelta(previous, { ...current, contextId: 2 }).mediaShortfallMs, undefined);
  assert.equal(audioClockDelta(previous, { ...current, rate: 1.5 }).mediaShortfallMs, undefined);
  assert.equal(audioClockDelta(previous, { ...current, rate: 0 }).mediaShortfallMs, undefined);
  assert.equal(
    audioClockDelta({ ...previous, rate: 1.5 }, { ...current, rate: 1.5, position: 11.5 })
      .mediaShortfallMs,
    0
  );
});
