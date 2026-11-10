// src/services/analysis/vocalEnvelope.ts
// A track's vocal envelope off htdemucs' vocal stem: how loud the singing is, frame by frame, and
// where each sung syllable starts. 雾笺 (Nebbia) drops its rain on it: the louder the voice, the
// more small drops hit the glass, and a big one on every onset.
//
// The stem comes from the track's stem run (trackStemRun.ts), the one the drum hits read: htdemucs
// gives back all four stems for every segment anyway, so the vocal task (vocalStemRun.ts) reads the
// fourth off the segments the drums are separated for, and the GPU runs no more than it did. Its features are read a stretch at a time as
// the stem is finished (vocalStream.ts: two numbers a frame, the samples let go), and the envelope is
// made of them once the whole stretch is in (`vocalEnvelopeOfFeatures`) - there is no live head as for
// the drum hits, as the loudness is read against the track's own top - and stored under the track's
// analysis key (VOCAL_ENVELOPE_PREFIX, in the 分析 cache beside the drum hits).
//
// The features are the ones the prototype's data was made of (the user's vocal-fx-demo, 50 fps):
// - `db`: RMS level in dB over 40 ms, centred on every frame (a frame every 20 ms).
// - `top`: the track's loud singing, the 97th percentile of `db`.
// - `onsets`: spectral flux of the stem's beat_this spectrogram (the drum hits' frames), peaks above
//   their own neighbourhood, over a floor below `top`, where the level is not falling away (a note
//   let go splatters across the spectrum too). Checked against that data on its three stems
//   (2026-10-28): the level within 0.04-0.14 dB on average, `top` within 0.2 dB, and 80-90% of its
//   onsets found within 40 ms, 83-98% of these onsets among its.
//
// An envelope can start part way (`from`, a frame): 雾笺 switched to mid-track separates the voice from
// the playhead on (vocalStemRun.ts' `vocalStartFor`), the head before it being zeros. `top`, the flux's spread
// and the onsets are then read from `from` on - a few frames in from where the stem is whole, as the
// level's window and the spectrogram's reach back across it, and the step from silence is a flux peak
// of its own. Such an envelope is kept for the play but not stored: the stored one is the whole track's,
// from a play that separates the voice from the start.

/** beat_this' frame rate (BEAT_THIS_FPS), spelled out: read at load, where a test may stand in for beatThis.ts. */
export const VOCAL_FPS = 50;

export interface VocalEnvelope {
    fps: number;
    /** Level per frame, dB. */
    db: Float32Array;
    /** The track's loud singing, dB: the 97th percentile of `db`. */
    top: number;
    /** Frames where a sung syllable starts, ascending. */
    onsets: Uint32Array;
    /** The first frame read (see the header): before it the stem was not separated. Missing for the whole track. */
    from?: number;
}

export const getVocalEnvelope = (_key: string | null): VocalEnvelope | null => null;
