// 摘自 Folia 的 src/types.ts，只保留“浮名”样式用到的类型（AGPL-3.0，见 ./NOTICE.md）
import type { MotionValue } from 'framer-motion';
import type { LineRenderHints } from './utils/lyrics/renderHints';

export interface LyricRuby {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
}

export interface LyricSyllable {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
  endsWithSpace?: boolean;
  ruby?: LyricRuby[];
  obscene?: boolean;
  emptyBeat?: number;
}

export interface LyricAlternateText {
  role: 'translation' | 'romanization' | string;
  language?: string;
  text: string;
  syllables?: LyricSyllable[];
}

export interface Word {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
  syllables?: LyricSyllable[];
}

export interface LyricBackgroundVocal {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
  words: Word[];
  agentId?: string;
  translation?: string;
  romanization?: string;
  alternateTexts?: LyricAlternateText[];
}

export type SubtitleContentMode = 'translation' | 'romanization' | 'both' | 'none';

export type SubtitleOverlayRowSource = 'current' | 'next' | 'translation' | 'romanization';

export type SubtitleOverlayFollowRow = Exclude<SubtitleOverlayRowSource, 'current'>;

export type SubtitleOverlayLayout =
  | Exclude<SubtitleOverlayRowSource, 'next'>
  | `current+${SubtitleOverlayFollowRow}`
  | `current+${SubtitleOverlayFollowRow}+${SubtitleOverlayFollowRow}`;

export interface Line {
  /** 逐字时间是按逐句歌词估算的（本项目新增，用来减弱唱字动作） */
  estimatedWordTiming?: boolean;
  words: Word[];
  startTime: number;
  endTime: number;
  fullText: string;
  translation?: string;
  id?: string;
  agentId?: string;
  songPart?: string;
  blockIndex?: number;
  romanization?: string;
  alternateTexts?: LyricAlternateText[];
  backgroundVocal?: LyricBackgroundVocal;
  backgroundVocals?: LyricBackgroundVocal[];
  renderHints?: LineRenderHints;
  isChorus?: boolean;
  chorusEffect?: 'bars' | 'circles' | 'beams';
  // User-saved fine word boundaries for fullText, baked in upstream by the lyric setter.
  // join('') must equal fullText. When present it wins over every automatic segmentation.
  wordSegments?: string[];
  // icu-folia's automatic word boundaries for fullText (utils/lyrics/icuFolia), baked in by the
  // lyric setter once its engines have loaded. Used when there is no wordSegments; absent until
  // then, and the line falls back to plain Intl.Segmenter.
  autoWordSegments?: string[];
}

export interface Theme {
  name: string;
  backgroundColor: string;
  primaryColor: string;
  accentColor: string;
  secondaryColor: string;
  fontStyle: 'sans' | 'serif' | 'mono';
  fontFamily?: string;
  fontFamilyStack?: string[];
  fontWeight?: number;
  animationIntensity: 'calm' | 'normal' | 'chaotic';
  wordColors?: { word: string; color: string; }[];
  lyricsIcons?: string[];
  provider?: string;
  description?: string;
}

export type LyricRenderScale = 0.5 | 0.75 | 1 | 1.5 | 2;

export type LyricAntialias = 'auto' | 'on' | 'off';

export interface LyricRenderQuality {
  scale: LyricRenderScale;
  antialias: LyricAntialias;
}

export interface LyricRenderOverride {
  scale: 'global' | LyricRenderScale;
  antialias: 'global' | 'on' | 'off';
}

export interface FumeTuning {
  /** 分辨率与抗锯齿（#929）：默认跟随「动画与性能」里的全局挡位（utils/lyricRenderQuality.ts）。 */
  render: LyricRenderOverride;
  hidePrintSymbols: boolean;
  disableGeometricBackground: boolean;
  backgroundObjectOpacity: number;
  textHoldRatio: number;
  cameraTrackingMode: 'stepped' | 'smooth';
  cameraSpeed: number;
  glowIntensity: number;
  heroScale: number;
}

export const DEFAULT_FUME_TUNING: FumeTuning = {
  render: { scale: 'global', antialias: 'global' },
  hidePrintSymbols: false,
  disableGeometricBackground: true,
  backgroundObjectOpacity: 0.5,
  textHoldRatio: 1,
  cameraTrackingMode: 'smooth',
  cameraSpeed: 1,
  glowIntensity: 1,
  heroScale: 1,
};

export interface AudioBands {
    bass: MotionValue<number>;    // 20-150Hz (Circles)
    lowMid: MotionValue<number>;  // 150-400Hz (Squares)
    mid: MotionValue<number>;     // 400-1200Hz (Triangles)
    vocal: MotionValue<number>;   // 1000-3500Hz (Icons)
    treble: MotionValue<number>;  // 3500Hz+ (Crosses)
    spectrum?: MotionValue<Uint8Array<ArrayBuffer>>; // Raw analyser FFT magnitude bins for full-spectrum visualizers
  }

export type TiltColorScheme = 'default' | 'swap' | 'accentAll' | 'primaryAll';

export type VisualizerFrameRate = 'off' | 120 | 90 | 60;

export interface ClassicTuning {
  enableWordRotation: boolean;
  breathingFloatMultiplier: number;
  useLegacyLayout?: boolean;
  wordSpacing?: number;
  /** Space the words by how far they are drawn when scaled, turned and offset, so none overlaps another. */
  avoidOverlap?: boolean;
}

export const DEFAULT_CLASSIC_TUNING: ClassicTuning = {
  enableWordRotation: true,
  breathingFloatMultiplier: 1,
  useLegacyLayout: false,
  wordSpacing: 0.7,
  avoidOverlap: false,
};

export interface TiltTuning {
  splitProbability: number;
  tiltStyleProbability: number;
  colorScheme?: TiltColorScheme;
}

export const DEFAULT_TILT_TUNING: TiltTuning = {
  splitProbability: 0.75,
  tiltStyleProbability: 0.35,
  colorScheme: 'default',
};

export interface PartitaTuning {
  showGuideLines: boolean;
  useSemanticLayout: boolean;
  staggerMin: number;
  staggerMax: number;
  /** Space the words and rows by how far they are drawn when scaled, so none overlaps another. */
  avoidOverlap?: boolean;
}

export const DEFAULT_PARTITA_TUNING: PartitaTuning = {
  showGuideLines: true,
  useSemanticLayout: true,
  staggerMin: 20,
  staggerMax: 100,
  avoidOverlap: false,
};

export interface CladdaghTuning {
  focusScaleRatio: number;
  radiusScale: number;
  ellipseTiltDeg: number;
  showAxisLine: boolean;
  letterSpacingOffset: number;
}

export const DEFAULT_CLADDAGH_TUNING: CladdaghTuning = {
  focusScaleRatio: 0.65,
  radiusScale: 1.0,
  ellipseTiltDeg: 45,
  showAxisLine: true,
  letterSpacingOffset: 0,
};

export interface CadenzaTuning {
  /** 分辨率与抗锯齿（#929）：默认跟随「动画与性能」里的全局挡位（utils/lyricRenderQuality.ts）。 */
  render: LyricRenderOverride;
  fontScale: number;
  widthRatio: number;
  motionAmount: number;
  glowIntensity: number;
  beamIntensity: number;
}

export const DEFAULT_CADENZA_TUNING: CadenzaTuning = {
  render: { scale: 'global', antialias: 'global' },
  fontScale: 1.12,
  widthRatio: 0.72,
  motionAmount: 1,
  glowIntensity: 1,
  beamIntensity: 0,
};
