import type { MotionValue } from 'framer-motion';
import type { AudioBands, CadenzaTuning, CladdaghTuning, ClassicTuning, FumeTuning, Line, PartitaTuning, SubtitleContentMode, SubtitleOverlayLayout, Theme, TiltTuning } from '../../types';
import type { VisualizerBackgroundConfig } from './backgrounds/definition';

// 摘自 Folia 的 definition.ts，只保留“浮名”读取的属性。

export interface VisualizerSharedProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    subtitleTheme?: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    isDaylight?: boolean;
    coverUrl?: string | null;
    seed?: string | number;
    staticMode?: boolean;
    background?: VisualizerBackgroundConfig;
    lyricsFontScale?: number;
    subtitleFontScale?: number;
    subtitleOverlayOpacity?: number;
    subtitleOverlayBackground?: boolean;
    subtitleUpcomingLyricsBlur?: boolean;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    subtitleOverlayLayout?: SubtitleOverlayLayout;
    paused?: boolean;
    isPreviewMode?: boolean;
    fumeTuning?: FumeTuning;
    classicTuning?: ClassicTuning;
    tiltTuning?: TiltTuning;
    partitaTuning?: PartitaTuning;
    claddaghTuning?: CladdaghTuning;
    cadenzaTuning?: CadenzaTuning;
    subtitleContentMode?: SubtitleContentMode;
    showSubtitleTranslation?: boolean;
}
