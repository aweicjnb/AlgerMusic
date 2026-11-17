import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { RhythmAnalyzer } from '../src/renderer/services/rhythmAnalysis.ts';

// Resolve the same extensionless local imports Vite uses, without a bundler or test dependency.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
    return next(specifier, context);
  }
});
const { matchLyricStyle } = await import('../src/renderer/folia/lyricStyleMatch.ts');

function frame(time, amplitude, jitter = 0) {
  const spectrum = new Uint8Array(1024);
  for (let i = 2; i < 300; i++) spectrum[i] = Math.round(25 + amplitude * (i < 50 ? 500 : 250));
  const waveform = new Float32Array(2048);
  for (let i = 0; i < waveform.length; i++) waveform[i] = amplitude * Math.sin(i * 0.08);
  return { time: time + jitter, spectrum, waveform, sampleRate: 48000 };
}

function pulses(bpm, seconds = 13, options = {}) {
  const analyzer = new RhythmAnalyzer();
  let result;
  for (let i = 0; i < seconds * 50; i++) {
    const time = i / 50;
    const phase = (time + 60 / bpm - (options.intro || 0)) % (60 / bpm);
    const amplitude = time < (options.intro || 0) ? 0 : 0.025 + 0.35 * Math.exp(-phase / 0.035);
    result = analyzer.push(frame(time, amplitude, options.jitter ? Math.sin(i * 1.79) * 0.003 : 0));
  }
  return { analyzer, result };
}

for (const bpm of [60, 72, 96, 120, 150, 180]) {
  test(`estimates a ${bpm} BPM audio pulse train`, () => {
    const { result } = pulses(bpm);
    assert.equal(result.status, 'ready', JSON.stringify(result));
    assert.ok(Math.abs(result.bpm - bpm) <= 3, JSON.stringify(result));
    assert.ok(result.confidence >= 0.62);
  });
}

test('handles an intro and irregular sampling intervals', () => {
  const { result } = pulses(128, 15, { intro: 2, jitter: true });
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.ok(Math.abs(result.bpm - 128) <= 3, JSON.stringify(result));
});

test('silence and a sustained tone do not invent a tempo', () => {
  for (const amplitude of [0, 0.1]) {
    const analyzer = new RhythmAnalyzer();
    for (let i = 0; i < 700; i++) analyzer.push(frame(i / 50, amplitude));
    assert.equal(analyzer.read().bpm, null);
    assert.equal(analyzer.read().status, 'uncertain');
  }
});

test('silence clears a previously confident estimate and seeks reset the window', () => {
  const { analyzer } = pulses(120);
  for (let i = 650; i < 800; i++) analyzer.push(frame(i / 50, 0));
  assert.equal(analyzer.read().bpm, null);
  analyzer.push(frame(2, 0.2));
  assert.equal(analyzer.read().status, 'collecting');
  assert.equal(analyzer.read().analyzedSeconds, 0);
  assert.equal(analyzer.read().onsetCount, 0);
});

test('irregular transients are not presented as a confident tempo', () => {
  const analyzer = new RhythmAnalyzer();
  let next = 0.3,
    state = 12345;
  for (let i = 0; i < 700; i++) {
    const time = i / 50;
    const hit = time >= next;
    if (hit) {
      state = (state * 1664525 + 1013904223) >>> 0;
      next += 0.25 + (state / 2 ** 32) * 0.9;
    }
    analyzer.push(frame(time, hit ? 0.35 : 0.02));
  }
  assert.notEqual(analyzer.read().status, 'ready', JSON.stringify(analyzer.read()));
});

const rhythm = (bpm, energy) => ({
  status: 'ready',
  bpm,
  confidence: 0.95,
  energy,
  beatStrength: 0.7,
  analyzedSeconds: 12,
  onsetCount: 20
});
test('audio changes a tagless song toward calm or energetic animation families', () => {
  const slow = matchLyricStyle(undefined, undefined, () => 0, rhythm(72, 0.2));
  const fast = matchLyricStyle(undefined, undefined, () => 0, rhythm(160, 0.85));
  assert.ok(['still', 'nebbia', 'lumiere', 'monet'].includes(slow.style), JSON.stringify(slow));
  assert.ok(['sonnet', 'tempera', 'hanabi', 'diorama'].includes(fast.style), JSON.stringify(fast));
  assert.notEqual(slow.style, fast.style);
  assert.ok(slow.rhythmApplied && fast.rhythmApplied);
});

test('uncertain audio falls back to lyric rules and fast audio does not erase sad lyrics', () => {
  const lyric = '心碎 难过 悲伤 好孤单 孤独 寂寞 离别 再见 失去你';
  const fallback = matchLyricStyle(lyric, undefined, () => 0);
  const uncertain = matchLyricStyle(lyric, undefined, () => 0, {
    ...rhythm(160, 0.85),
    status: 'uncertain'
  });
  assert.equal(uncertain.style, fallback.style);
  assert.equal(uncertain.rhythmApplied, false);
  const fast = matchLyricStyle(lyric, undefined, () => 0, rhythm(160, 0.85));
  assert.ok(!['hanabi', 'tempera', 'sonnet'].includes(fast.style), JSON.stringify(fast));
});
