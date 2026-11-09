/** @jsxImportSource react */
import type React from 'react';
import { motionValue, type MotionValue } from 'framer-motion';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import type { VisualizerSharedProps } from './components/visualizer/definition';
import type { FoliaStyle } from './styles';
import { DEFAULT_FUME_TUNING, type AudioBands, type FumeTuning, type Line, type Theme } from './types';

// 在 Vue 页面里挂载 Folia 的 React 歌词动画。

// 每种样式单独分包，用到时才加载
const VISUALIZERS: Record<FoliaStyle, React.LazyExoticComponent<React.ComponentType<VisualizerSharedProps>>> = {
    fume: lazy(() => import('./components/visualizer/fume/VisualizerFume')),
    classic: lazy(() => import('./components/visualizer/classic/Visualizer')),
    tilt: lazy(() => import('./components/visualizer/tilt/VisualizerTilt')),
    partita: lazy(() => import('./components/visualizer/partita/VisualizerPartita')),
    claddagh: lazy(() => import('./components/visualizer/claddagh/VisualizerCladdagh')),
    cadenza: lazy(() => import('./components/visualizer/cadenza/VisualizerCadenza')),
    still: lazy(() => import('./components/visualizer/still/VisualizerStill')),
};

// 关掉每个字点亮前落下的色块（print stamp）
const FUME_TUNING: FumeTuning = { ...DEFAULT_FUME_TUNING, hidePrintSymbols: true };

export interface FoliaStageState {
    mode: FoliaStyle;
    songKey: string | number;
    lines: Line[];
    lineIndex: number;
    theme: Theme;
}

export interface FoliaStageHandle {
    setState: (patch: Partial<FoliaStageState>) => void;
    setTime: (seconds: number) => void;
    unmount: () => void;
}

export const mountFoliaStage = (element: HTMLElement, initial: FoliaStageState): FoliaStageHandle => {
    let state = initial;
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };
    const getState = () => state;

    const currentTime = motionValue(0);
    // 目前没有接音频频谱，“浮名”的文字不依赖它，只有背景图形会随音乐变化。
    const silent = (): MotionValue<number> => motionValue(0);
    const audioPower = silent();
    const audioBands: AudioBands = {
        bass: silent(),
        lowMid: silent(),
        mid: silent(),
        vocal: silent(),
        treble: silent(),
    };

    const Stage = () => {
        const { mode, songKey, lines, lineIndex, theme } = useSyncExternalStore(subscribe, getState);
        const Visualizer = VISUALIZERS[mode];
        return (
            <Suspense fallback={null}>
            <Visualizer
                key={`${mode}:${songKey}`}
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
            listeners.forEach(listener => listener());
        },
        setTime: seconds => currentTime.set(seconds),
        unmount: () => root.unmount(),
    };
};
