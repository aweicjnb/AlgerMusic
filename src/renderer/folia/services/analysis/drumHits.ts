// src/services/analysis/drumHitPicking.ts
// The drum hits' arithmetic, apart from running anything (split out of drumHits.ts, which separates
// and keeps them): the bands of a drum stem's spectrogram, the hits picked off them, and the energy
// the drumless guard compares.
//
// A hit is where the stem rises: each of three bands (kick below KICK_MAX_HZ, snare up to SNARE_MAX_HZ,
// hats from HAT_MIN_HZ) against that band's own loud hits (HIT_TOP), a hit wherever the largest of the
// three peaks (a local maximum over PEAK_HALF frames either side, at least MIN_HIT_GAP apart) above
// HIT_ONSET_FLOOR, filed under the band that rose most, as strong as that share (0..1).
//
// A track with next to no drums has none (`getDrumHits` null): htdemucs still hands back a stem, and
// in a track without drums it is what leaked in - a bass line read as kicks (雪绒花). The guard is how
// much of the track the drums play in (`drumCoverage`), not how loud they are on the median: a song
// with drums in only half of it (小半, 麦恩莉) reads near 0 on the median like 雪绒花. Measured on the
// user's 21 separated tracks (2026-10-17): Edelweiss 0.006, 理想三旬 0.024, 第二圆舞曲 0.043, then
// every track with a drum kit from 0.135 up (走马 0.148), so DRUMLESS_COVERAGE sits in that gap. The
// stem's and the mix's energy are stored beside the hits so the guard can be tuned without separating
// anything again.

export type DrumHitKind = 0 | 1 | 2;

export const DRUM_KICK: DrumHitKind = 0;

export const DRUM_SNARE: DrumHitKind = 1;

export const DRUM_HAT: DrumHitKind = 2;

export interface DrumHits {
    times: Float64Array;
    strengths: Float32Array;
    kinds: Uint8Array;
    /** While the track is still separating: the time (s) the hits reach, none after it known yet. */
    until?: number;
}

// AlgerMusic has no stem separation provider.
export const getDrumHits = (_key: string | null): DrumHits | null => null;
