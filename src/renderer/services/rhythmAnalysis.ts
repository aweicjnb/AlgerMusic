// Streaming onset-envelope autocorrelation. No audio buffers leave this process.
// Method background: https://librosa.org/doc/latest/auto_tutorials/01-intro/06-rhythm.html
export type RhythmPace = 'slow' | 'medium' | 'fast';
export interface RhythmSummary {
  status: 'collecting' | 'ready' | 'uncertain' | 'unavailable' | 'paused';
  bpm: number | null;
  confidence: number;
  energy: number;
  beatStrength: number;
  analyzedSeconds: number;
  onsetCount: number;
}

export const emptyRhythmSummary = (): RhythmSummary => ({
  status: 'collecting',
  bpm: null,
  confidence: 0,
  energy: 0,
  beatStrength: 0,
  analyzedSeconds: 0,
  onsetCount: 0
});
export const rhythmPace = (bpm: number): RhythmPace =>
  bpm < 90 ? 'slow' : bpm >= 130 ? 'fast' : 'medium';
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
interface Frame {
  time: number;
  onset: number;
  rms: number;
}
export interface RhythmInput {
  time: number;
  sampleRate: number;
  spectrum: Uint8Array<ArrayBuffer>;
  waveform: Float32Array<ArrayBuffer>;
}

export class RhythmAnalyzer {
  private previousSpectrum = new Uint8Array(0);
  private frames: Frame[] = [];
  private onsets: number[] = [];
  private lastTime = -1;
  private lastEstimateAt = -1;
  private lastSignalAt = -1;
  private lastPeakAt = -1;
  private candidateBpm = 0;
  private stableWindows = 0;
  private summary = emptyRhythmSummary();

  reset(): void {
    this.previousSpectrum = new Uint8Array(0);
    this.frames = [];
    this.onsets = [];
    this.lastTime = this.lastEstimateAt = this.lastSignalAt = this.lastPeakAt = -1;
    this.candidateBpm = this.stableWindows = 0;
    this.summary = emptyRhythmSummary();
  }

  read(): RhythmSummary {
    return { ...this.summary };
  }

  push(input: RhythmInput): RhythmSummary {
    const { time, sampleRate, spectrum, waveform } = input;
    if (!Number.isFinite(time) || !sampleRate || !spectrum.length || !waveform.length)
      return this.read();
    if (this.lastTime >= 0 && (time < this.lastTime || time - this.lastTime > 0.35)) this.reset();
    const elapsed = this.lastTime < 0 ? 0.02 : time - this.lastTime;
    if (elapsed < 0.01) return this.read();
    this.lastTime = time;
    let sum = 0;
    for (const sample of waveform) sum += sample * sample;
    const rms = Math.sqrt(sum / waveform.length);
    let flux = 0;
    const hzPerBin = sampleRate / (spectrum.length * 2);
    if (this.previousSpectrum.length === spectrum.length) {
      for (const [low, high, weight] of [
        [35, 200, 0.45],
        [200, 2000, 0.35],
        [2000, 8000, 0.2]
      ]) {
        const first = Math.max(1, Math.floor(low / hzPerBin));
        const end = Math.min(spectrum.length, Math.ceil(high / hzPerBin));
        let rise = 0;
        for (let bin = first; bin < end; bin++)
          rise += Math.max(0, spectrum[bin] - this.previousSpectrum[bin]);
        flux += (weight * rise) / (Math.max(1, end - first) * 255);
      }
    }
    this.previousSpectrum = spectrum.slice();
    const previous = this.frames[this.frames.length - 1];
    const onset = rms > 0.001 ? flux * 0.8 + Math.max(0, rms - (previous?.rms ?? rms)) * 0.2 : 0;
    // Peak picking uses only the preceding second, then confirms on the next sample.
    const recent = this.frames.filter((frame) => time - frame.time < 1);
    const mean =
      recent.reduce((total, frame) => total + frame.onset, 0) / Math.max(1, recent.length);
    const variance =
      recent.reduce((total, frame) => total + (frame.onset - mean) ** 2, 0) /
      Math.max(1, recent.length);
    const threshold = Math.max(0.006, mean + Math.sqrt(variance) * 1.15);
    const before = this.frames[this.frames.length - 2];
    this.summary.beatStrength *= Math.exp(-elapsed / 0.14);
    if (
      previous &&
      before &&
      previous.onset > threshold &&
      previous.onset >= before.onset &&
      previous.onset > onset &&
      previous.time - this.lastPeakAt > 0.22
    ) {
      this.onsets.push(previous.time);
      this.lastPeakAt = previous.time;
      this.summary.beatStrength = clamp(previous.onset / (threshold * 2));
    }
    this.frames.push({ time, onset, rms });
    while (this.frames.length && time - this.frames[0].time > 14) this.frames.shift();
    while (this.onsets.length && time - this.onsets[0] > 14) this.onsets.shift();
    if (rms > 0.001) this.lastSignalAt = time;
    const energy = rms < 0.001 ? 0 : clamp((20 * Math.log10(rms) + 55) / 45);
    this.summary.energy += (energy - this.summary.energy) * (1 - Math.exp(-elapsed / 1.5));
    this.summary.analyzedSeconds = time - this.frames[0].time;
    this.summary.onsetCount = this.onsets.length;
    if (time - this.lastSignalAt > 2) {
      this.summary.bpm = null;
      this.summary.confidence = 0;
      this.summary.status = this.summary.analyzedSeconds >= 8 ? 'uncertain' : 'collecting';
      this.stableWindows = 0;
    } else if (time - this.lastEstimateAt >= 1 && this.summary.analyzedSeconds >= 5) {
      this.lastEstimateAt = time;
      this.estimate();
    }
    return this.read();
  }

  private estimate(): void {
    const frames = this.frames;
    const step = 0.02;
    const start = frames[0].time;
    const length = Math.floor((frames[frames.length - 1].time - start) / step);
    const envelope = new Float64Array(length);
    let cursor = 1;
    for (let i = 0; i < length; i++) {
      const time = start + i * step;
      while (cursor < frames.length - 1 && frames[cursor].time < time) cursor++;
      const a = frames[cursor - 1],
        b = frames[cursor];
      const ratio = clamp((time - a.time) / Math.max(0.001, b.time - a.time));
      envelope[i] = a.onset + (b.onset - a.onset) * ratio;
    }
    // A short triangular window tolerates timer/FFT-window jitter without blurring adjacent beats.
    const rawEnvelope = envelope.slice();
    for (let i = 1; i < length - 1; i++)
      envelope[i] = rawEnvelope[i - 1] * 0.25 + rawEnvelope[i] * 0.5 + rawEnvelope[i + 1] * 0.25;
    const mean = envelope.reduce((sum, value) => sum + value, 0) / Math.max(1, length);
    const correlations: { period: number; score: number }[] = [];
    for (let lag = Math.ceil(60 / 200 / step); lag <= Math.floor(60 / 55 / step); lag++) {
      let product = 0,
        energyA = 0,
        energyB = 0;
      for (let i = lag; i < length; i++) {
        const a = envelope[i] - mean,
          b = envelope[i - lag] - mean;
        product += a * b;
        energyA += a * a;
        energyB += b * b;
      }
      correlations.push({
        period: lag * step,
        score: product / Math.max(1e-12, Math.sqrt(energyA * energyB))
      });
    }
    correlations.sort((a, b) => b.score - a.score);
    const intervals = this.onsets.slice(1).map((time, index) => time - this.onsets[index]);
    const typical = intervals.length ? median(intervals) : 0.5;
    const best = correlations[0];
    // Resolve similar half/double-time candidates by the actual detected onset spacing.
    const supported = correlations.filter((item) => item.score >= Math.max(0.3, best.score * 0.6));
    const candidate = (supported.length ? supported : [best]).sort(
      (a, b) => Math.abs(Math.log(a.period / typical)) - Math.abs(Math.log(b.period / typical))
    )[0];
    const periods = intervals.flatMap((interval) => {
      const beats = Math.max(1, Math.round(interval / candidate.period));
      const period = interval / beats;
      return Math.abs(period - candidate.period) < 0.07 ? [period] : [];
    });
    const period = periods.length
      ? periods.reduce((sum, value) => sum + value, 0) / periods.length
      : candidate.period;
    const bpm = 60 / period;
    const regularity = periods.length / Math.max(1, intervals.length);
    const confidence = clamp(Math.max(0, candidate.score) * 0.65 + regularity * 0.35);
    if (confidence >= 0.62 && this.onsets.length >= 6 && bpm >= 55 && bpm <= 200) {
      this.stableWindows = Math.abs(bpm - this.candidateBpm) <= 4 ? this.stableWindows + 1 : 1;
      this.candidateBpm = bpm;
      this.summary.bpm = Math.round(bpm);
      this.summary.confidence = confidence;
      this.summary.status =
        this.stableWindows >= 3 && this.summary.analyzedSeconds >= 7 ? 'ready' : 'collecting';
    } else {
      this.stableWindows = 0;
      this.summary.bpm = null;
      this.summary.confidence = confidence;
      this.summary.status = this.summary.analyzedSeconds >= 8 ? 'uncertain' : 'collecting';
    }
  }
}
