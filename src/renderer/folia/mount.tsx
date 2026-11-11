/** @jsxImportSource react */
import { type MotionValue,motionValue } from 'framer-motion';
import type React from 'react';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import type { VisualizerSharedProps } from './components/visualizer/definition';
import { DEFAULT_HANABI_TUNING } from './components/visualizer/hanabi/types';
import { DEFAULT_MACHI_TUNING } from './components/visualizer/machi/types';
import type { FoliaStyle } from './styles';
import {
  type AudioBands,
  DEFAULT_FUME_TUNING,
  type FumeTuning,
  type Line,
  type Theme
} from './types';

// 在 Vue 页面里挂载 Folia 的 React 歌词动画。

// 每种样式单独分包，用到时才加载
const VISUALIZERS: Record<
  FoliaStyle,
  React.LazyExoticComponent<React.ComponentType<VisualizerSharedProps>>
> = {
  fume: lazy(() => import('./components/visualizer/fume/VisualizerFume')),
  classic: lazy(() => import('./components/visualizer/classic/Visualizer')),
  tilt: lazy(() => import('./components/visualizer/tilt/VisualizerTilt')),
  partita: lazy(() => import('./components/visualizer/partita/VisualizerPartita')),
  claddagh: lazy(() => import('./components/visualizer/claddagh/VisualizerCladdagh')),
  cadenza: lazy(() => import('./components/visualizer/cadenza/VisualizerCadenza')),
  still: lazy(() => import('./components/visualizer/still/VisualizerStill')),
  sonnet: lazy(() => import('./components/visualizer/sonnet/VisualizerSonnet')),
  hanabi: lazy(() =>
    import('./components/visualizer/hanabi/VisualizerHanabi').then(({ default: Hanabi }) => ({
      default: (props: VisualizerSharedProps) => (
        <Hanabi {...props} hanabiTuning={DEFAULT_HANABI_TUNING} />
      )
    }))
  ),
  monet: lazy(() => import('./components/visualizer/monet/VisualizerMonet')),
  pendolo: lazy(() => import('./components/visualizer/pendolo/VisualizerPendolo')),
  diorama: lazy(() => import('./components/visualizer/diorama/VisualizerDiorama')),
  nebbia: lazy(() => import('./components/visualizer/nebbia/VisualizerNebbia')),
  cappella: lazy(() => import('./components/visualizer/cappella/VisualizerCappella')),
  lumiere: lazy(() => import('./components/visualizer/lumiere/VisualizerLumiere')),
  tempera: lazy(() => import('./components/visualizer/tempera/VisualizerTempera')),
  machi: lazy(() =>
    import('./components/visualizer/machi/VisualizerMachi').then(({ default: Machi }) => ({
      default: (props: VisualizerSharedProps) => (
        <Machi {...props} machiTuning={DEFAULT_MACHI_TUNING} />
      )
    }))
  ),
  minions: lazy(() => import('./components/visualizer/minions/VisualizerMinions'))
};

// 关掉每个字点亮前落下的色块（print stamp）
const FUME_TUNING: FumeTuning = { ...DEFAULT_FUME_TUNING, hidePrintSymbols: true };

export interface FoliaStageState {
  mode: FoliaStyle;
  songKey: string | number;
  lines: Line[];
  lineIndex: number;
  theme: Theme;
  song: Pick<
    VisualizerSharedProps,
    'songTitle' | 'songArtist' | 'songAlbum' | 'coverUrl' | 'duration'
  >;
}

export interface FoliaStageHandle {
  setState: (patch: Partial<FoliaStageState>) => void;
  setTime: (seconds: number) => void;
  unmount: () => void;
}

export const mountFoliaStage = (
  element: HTMLElement,
  initial: FoliaStageState,
  readSpectrum: (bins: Uint8Array<ArrayBuffer>) => number
): FoliaStageHandle => {
  let state = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getState = () => state;

  const currentTime = motionValue(0);
  const silent = (): MotionValue<number> => motionValue(0);
  const audioPower = silent();
  const bins = new Uint8Array(1024);
  const emptyBins = new Uint8Array(0);
  const spectrum = motionValue(emptyBins);
  const audioBands: AudioBands = {
    bass: silent(),
    lowMid: silent(),
    mid: silent(),
    vocal: silent(),
    treble: silent(),
    spectrum
  };
  const bands = [
    [20, 150, audioBands.bass],
    [150, 400, audioBands.lowMid],
    [400, 1200, audioBands.mid],
    [1000, 3500, audioBands.vocal],
    [3500, 10000, audioBands.treble]
  ] as const;
  // Keep the original seven styles' audio response as it was before the port.
  const audioModes: ReadonlySet<FoliaStyle> = new Set([
    'monet',
    'diorama',
    'lumiere',
    'pendolo',
    'sonnet',
    'machi'
  ]);

  const updateAudio = () => {
    const sampleRate = audioModes.has(state.mode) ? readSpectrum(bins) : 0;
    if (!sampleRate) spectrum.set(emptyBins);
    else if (spectrum.get() !== bins) spectrum.set(bins);

    let energy = 0;
    for (const [from, to, value] of bands) {
      let average = 0;
      if (sampleRate) {
        const hzPerBin = sampleRate / (bins.length * 2);
        const first = Math.floor(from / hzPerBin);
        const end = Math.min(bins.length, Math.ceil(to / hzPerBin));
        for (let index = first; index < end; index++) average += bins[index];
        average /= Math.max(1, end - first);
      }
      value.set(average);
      energy += average;
    }
    audioPower.set(energy / bands.length);
  };

  const Stage = () => {
    const { mode, songKey, lines, lineIndex, theme, song } = useSyncExternalStore(
      subscribe,
      getState
    );
    const Visualizer = VISUALIZERS[mode];
    return (
      <Suspense fallback={null}>
        <Visualizer
          {...song}
          key={mode === 'minions' ? mode : `${mode}:${songKey}`}
          currentTime={currentTime}
          currentLineIndex={lineIndex}
          lines={lines}
          theme={theme}
          audioPower={audioPower}
          audioBands={audioBands}
          seed={songKey}
          fumeTuning={FUME_TUNING}
          // 暂停时也继续绘制，否则暂停状态下拖动进度，画面不会更新。
          paused={false}
        />
      </Suspense>
    );
  };

  const root = createRoot(element);
  root.render(<Stage />);

  return {
    setState: (patch) => {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    setTime: (seconds) => {
      updateAudio();
      currentTime.set(seconds);
    },
    unmount: () => root.unmount()
  };
};
