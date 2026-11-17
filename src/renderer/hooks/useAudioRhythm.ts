import { onBeforeUnmount, type Ref, shallowRef, watch } from 'vue';

import { audioService } from '@/services/audioService';
import { emptyRhythmSummary, RhythmAnalyzer, type RhythmSummary } from '@/services/rhythmAnalysis';
import type { SongResult } from '@/types/music';
import { logPlayback, logTrack, playbackErrorFields } from '@/utils/playbackLog';

// Owned by the visible automatic-lyrics page. Closing it stops sampling and disconnects the branch.
export const useAudioRhythm = (enabled: Ref<boolean>, song: Ref<SongResult>) => {
  const rhythm = shallowRef<RhythmSummary>(emptyRhythmSummary());
  const analyzer = new RhythmAnalyzer();
  const spectrum = new Uint8Array(1024);
  const waveform = new Float32Array(2048);
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastSound: ReturnType<typeof audioService.getCurrentSound>;
  let lastTime = -1;
  let lastPublished = 0;
  let lastLogged = '';
  let missingFrames = 0;
  let failed = false;

  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    audioService.releaseRhythmAudio();
  };
  const reset = () => {
    analyzer.reset();
    rhythm.value = emptyRhythmSummary();
    lastSound = null;
    lastTime = -1;
    lastPublished = 0;
    lastLogged = '';
    missingFrames = 0;
    failed = false;
  };
  const sample = () => {
    if (failed || document.hidden) return;
    try {
      const current = audioService.getCurrentSound();
      const track = audioService.getCurrentTrack();
      if (track?.id !== song.value.id || track?.source !== song.value.source) return;
      if (current !== lastSound) {
        reset();
        lastSound = current;
      }
      if (!current?.playing()) {
        if (rhythm.value.status !== 'paused')
          rhythm.value = { ...analyzer.read(), status: 'paused', beatStrength: 0 };
        return;
      }
      const time = current.seek() as number;
      if (!Number.isFinite(time)) return;
      if (lastTime >= 0 && (time < lastTime || time - lastTime > 0.35)) {
        analyzer.reset();
        rhythm.value = emptyRhythmSummary();
        logPlayback('rhythm.reset', { track: logTrack(track), reason: 'seek-or-clock-gap' });
        lastLogged = '';
      }
      lastTime = time;
      const sampleRate = audioService.readRhythmAudio(spectrum, waveform);
      if (!sampleRate) {
        if (++missingFrames === 100) {
          rhythm.value = { ...emptyRhythmSummary(), status: 'unavailable' };
          logPlayback('rhythm.unavailable', {
            track: logTrack(track),
            reason: 'audio-graph-unavailable'
          });
        }
        return;
      }
      missingFrames = 0;
      const result = analyzer.push({ time, sampleRate, spectrum, waveform });
      const now = performance.now();
      if (now - lastPublished >= 500 || result.status !== rhythm.value.status) {
        lastPublished = now;
        rhythm.value = result;
        const stamp = `${result.status}:${result.bpm}`;
        if (stamp !== lastLogged && (result.status === 'ready' || result.status === 'uncertain')) {
          lastLogged = stamp;
          logPlayback('rhythm.analysis', {
            track: logTrack(track),
            status: result.status,
            bpm: result.bpm,
            confidence: Number(result.confidence.toFixed(2)),
            energy: Number(result.energy.toFixed(2)),
            analyzedSeconds: Number(result.analyzedSeconds.toFixed(1)),
            onsetCount: result.onsetCount
          });
        }
      }
    } catch (error) {
      failed = true;
      stop();
      rhythm.value = { ...emptyRhythmSummary(), status: 'unavailable' };
      logPlayback('rhythm.failed', { track: logTrack(song.value), ...playbackErrorFields(error) });
    }
  };
  watch(
    [enabled, () => song.value?.source, () => song.value?.id],
    ([active]) => {
      stop();
      reset();
      if (active && song.value?.id) {
        logPlayback('rhythm.start', { track: logTrack(song.value) });
        timer = setInterval(sample, 20);
        sample();
      }
    },
    { immediate: true }
  );
  onBeforeUnmount(stop);
  return rhythm;
};
