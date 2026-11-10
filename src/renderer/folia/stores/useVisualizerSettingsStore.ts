import type { VisualizerFrameRate } from '../types';

const settings = { smartBeat: { mode: 'off' }, visualizerFrameRate: 'off' as VisualizerFrameRate };

// The port uses renderer defaults without loading Folia's settings store.
export const useVisualizerSettingsStore = Object.assign(
    <T>(select: (state: typeof settings) => T) => select(settings),
    { getState: () => settings },
);
