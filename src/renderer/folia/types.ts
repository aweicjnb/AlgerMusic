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

// Original Folia settings and defaults for the additional lyric renderers.
export type CappellaEmojiPackSource = 'builtin' | 'custom';

export type CappellaAvatarSource = 'cover' | 'builtin' | 'color' | 'custom';

export interface CappellaTuning {
  showEmoMessages: boolean;
  emojiPackSource: CappellaEmojiPackSource;
  avatarSource: CappellaAvatarSource;
}

export const DEFAULT_CAPPELLA_TUNING: CappellaTuning = {
  showEmoMessages: true,
  emojiPackSource: 'builtin',
  avatarSource: 'cover',
};

export interface PendoloTuning {
  /** 分辨率与抗锯齿（#929）：默认跟随「动画与性能」里的全局挡位（utils/lyricRenderQuality.ts）。 */
  render: LyricRenderOverride;
  arcRadius: number;
  arcAngleDeg: number;
  wheelCenterX: number;
  wheelCenterY: number;
  tickSnappiness: number;
  activeScale: number;
  showGearDecor: 'none' | 'subtle' | 'full';
  showCenterGradient?: boolean;
  showCoverOnWatchFace?: boolean;
  enableLineGlow?: boolean;
}

export const DEFAULT_PENDOLO_TUNING: PendoloTuning = {
  render: { scale: 'global', antialias: 'global' },
  arcRadius: 0.42,
  arcAngleDeg: 100,
  wheelCenterX: 0.0,
  wheelCenterY: 0.50,
  tickSnappiness: 2.0,
  activeScale: 1.25,
  showGearDecor: 'subtle',
  showCenterGradient: true,
  showCoverOnWatchFace: false,
  enableLineGlow: false,
};

export type SonnetOuterFrameMode = 'none' | 'frame' | 'full';

export interface SonnetTuning {
  /** 分辨率与抗锯齿（#929）：默认跟随「动画与性能」里的全局挡位（utils/lyricRenderQuality.ts）。 */
  render: LyricRenderOverride;
  cameraIntensity: number;
  typographyMotion: number;
  mgDensity: number;
  showOnlyText: boolean;
  showGuide: boolean;
  showBackgroundMg: boolean;
  showFixedGeo: boolean;
  showGiantDecorativeText: boolean;
  showBackgroundDecor: boolean;
  enableTransitions: boolean;
  outerFrameMode: SonnetOuterFrameMode;
  textureResolution: number;
  /** Master switch for the scene-wide post-process stack (grain + contrast). */
  postProcessEnabled: boolean;
  /** Film grain amount, 0..1. */
  postProcessGrain: number;
  /** Contrast boost, 0..1. */
  postProcessContrast: number;
  /** Fixed print-style passes riding the master switch; strength sliders, 0 disables the pass. */
  postProcessRgbShift: number;
  postProcessHalftone: number;
  /** Vignette strength, 0..2 (2 = double the base darkening). */
  postProcessVignette: number;
  /** Radial lens curvature amount, 0..2. */
  postProcessLensDistortion: number;
  /** Radial chromatic dispersion amount, 0..1. */
  postProcessLensDispersion: number;
}

export const DEFAULT_SONNET_TUNING: SonnetTuning = {
  render: { scale: 'global', antialias: 'global' },
  cameraIntensity: 1,
  typographyMotion: 1,
  mgDensity: 1,
  showOnlyText: false,
  showGuide: true,
  showBackgroundMg: true,
  showFixedGeo: true,
  showGiantDecorativeText: true,
  showBackgroundDecor: true,
  enableTransitions: true,
  outerFrameMode: 'full',
  textureResolution: 1.5,
  postProcessEnabled: false,
  postProcessGrain: 0.2,
  postProcessContrast: 0,
  postProcessRgbShift: 0,
  postProcessHalftone: 0,
  postProcessVignette: 0.85,
  postProcessLensDistortion: 0.3,
  postProcessLensDispersion: 0.6,
};

/**
 * `gradient` fills every tone shape with a four-colour ramp built from the cover art's
 * extracted colours mixed with the theme, instead of a flat tone.
 */
export type TemperaColorMode = 'duo' | 'mono' | 'gradient';

/** Where an image tends to sit; the exact spot is picked per shot from the seed. */
export type TemperaLayerImageAlign = 'left' | 'center' | 'right' | 'free';

/** Vertical counterpart to `TemperaLayerImageAlign`; `free` lets each shot choose a band. */
export type TemperaLayerImageVerticalAlign = 'top' | 'center' | 'bottom' | 'free';

/**
 * One image in the user's Tempera pool - character art, a logo, a texture. Each shot picks one
 * of them and places it itself, so an image carries a *tendency* rather than coordinates:
 * hand-placing every picture would defeat the point of a pool. The file itself sits in
 * IndexedDB under the same `id`, keeping the tuning small enough to sync.
 */
export interface TemperaLayerImage {
  id: string;
  name: string;
  align: TemperaLayerImageAlign;
  verticalAlign: TemperaLayerImageVerticalAlign;
  /** Height as a fraction of the viewport height; width follows the source aspect. */
  scale: number;
  opacity: number;
}

export interface TemperaTuning {
  /** 分辨率与抗锯齿（#929）：默认跟随「动画与性能」里的全局挡位（utils/lyricRenderQuality.ts）。 */
  render: LyricRenderOverride;
  cameraIntensity: number;
  /** Per-glyph entrance motion strength, 0..2. */
  glyphMotion: number;
  /** Keep each source lyric line in one shot instead of slicing it into half-phrases. */
  wholeLineLyrics: boolean;
  /**
   * 逐字入场时序, 0..1. How much of the way to the shot's lyric end each glyph's entrance
   * stretches, past its 0.34s floor. 0 gives every glyph the same short window - percussive,
   * and the shot is fully at rest well before it cuts. 1 lands the whole shot exactly on its
   * lyric end - continuous, but nothing is ever still. See temperaLayout for the measurements.
   */
  glyphSettleStretch: number;
  /** 墨染奥行 景深, 0..2: the depth blur and the layers' parallax. Only while 墨染奥行 is on. */
  depthOfField: number;
  /** 墨染奥行 镜头平移, 0..2: how far each shot slides in and drifts. Only while 墨染奥行 is on. */
  depthPan: number;
  /** 墨染奥行 歌词远近, 0..2: how far small glyphs fade back and big ones lead. Only while 墨染奥行 is on. */
  glyphDepth: number;
  /** duo derives blocks from theme hues; mono collapses to a grayscale ink/paper ladder. */
  colorMode: TemperaColorMode;
  showBlocks: boolean;
  showDecor: boolean;
  /** 边角线框: the two registration marks in the top-left and bottom-right corners. */
  showCornerMarks: boolean;
  /**
   * 文字动态反色: the lyric samples the artwork under it and picks whichever of ink/paper
   * contrasts more, per pixel. This is how the mode colours type, not a post-process, so it
   * has its own switch rather than riding `postProcessEnabled`.
   */
  textInversion: boolean;
  /** Pool of user images; each shot picks one. The files themselves live in IndexedDB. */
  layerImages: TemperaLayerImage[];
  /** `back` lets the lyric invert against the picture; `front` puts it over the lyric. */
  layerImageDepth: 'back' | 'front';
  /** 0..1 chance that a given shot shows an image at all. */
  layerImageFrequency: number;
  enableTransitions: boolean;
  textureResolution: number;
  /** Master switch for the scene-wide post-process stack (grain + contrast + print passes). */
  postProcessEnabled: boolean;
  /**
   * 后处理纹理压缩: renders the post-process pass at 1x and stretches it onto the canvas
   * instead of running it at `textureResolution`. Costs sharpness on hatch, screentone and
   * type; buys back the fill rate a full-resolution full-screen pass costs.
   */
  postProcessTextureCompression: boolean;
  /** Film grain amount, 0..1. */
  postProcessGrain: number;
  /** Contrast boost, 0..1. */
  postProcessContrast: number;
  /** RGB shift pass strength, 0..1 (0 disables the pass). */
  postProcessRgbShift: number;
  /** Vignette strength, 0..2 (2 = double the base darkening). */
  postProcessVignette: number;
  /** Radial lens curvature amount, 0..2. */
  postProcessLensDistortion: number;
}

export const DEFAULT_TEMPERA_TUNING: TemperaTuning = {
  render: { scale: 'global', antialias: 'global' },
  cameraIntensity: 1,
  glyphMotion: 1,
  wholeLineLyrics: false,
  glyphSettleStretch: 0.5,
  depthOfField: 1,
  depthPan: 1,
  glyphDepth: 1,
  colorMode: 'duo',
  showBlocks: true,
  showDecor: true,
  showCornerMarks: true,
  textInversion: true,
  layerImages: [],
  layerImageDepth: 'back',
  layerImageFrequency: 0.6,
  enableTransitions: true,
  textureResolution: 1.5,
  postProcessEnabled: true,
  postProcessTextureCompression: false,
  postProcessGrain: 0.2,
  postProcessContrast: 0,
  postProcessRgbShift: 0,
  postProcessVignette: 0.85,
  postProcessLensDistortion: 0.3,
};

/**
 * 绘光画质档位。`full` 全分辨率；`balanced` / `low` 把光场与辉光降采样、烟雾倍频数封顶，用于省电。
 */
export type LumiereRenderQuality = 'full' | 'balanced' | 'low';

export interface LumiereTuning {
  /** 分辨率与抗锯齿（#929）：默认跟随「动画与性能」里的全局挡位（utils/lyricRenderQuality.ts）。 */
  render: LyricRenderOverride;
  /** 光强倍率, 0.3..2. */
  lightIntensity: number;
  /** 随音乐变亮, 0..2 (0 = 不随音乐变). */
  audioResponse: number;
  /** 烟雾浓度, 0..2. */
  fogDensity: number;
  /**
   * 暗场强度, 0..1：光后面铺一层主题背景色压暗的底，压住 folia 的共享背景（0 = 共享背景原样透出）。
   * 浅色主题保底 0.94（绘光始终在暗场里）。
   */
  darkField: number;
  /** 浮尘数量, 0..2. */
  moteAmount: number;
  /** 图形辉光, 0..2. */
  bloom: number;
  /** 文字辉光, 0..2. */
  textBloom: number;
  /** 未唱字透明度, 0.05..0.6. */
  unlitOpacity: number;
  /** 邻行：1 = 上一行 + 当前行，2 = 上一行 + 当前行 + 下一行. */
  windowNeighbors: 1 | 2;
  /** 崩解强度, 0..2. */
  decay: number;
  /** 背景歌词亮度, 0..2 (0 = 关). */
  echo: number;
  /** 烟雾细节（倍频数）, integer 2..6. */
  fogOctaves: number;
  /** 线稿. */
  lineArt: boolean;
  /** 前景散景. */
  frontBokeh: boolean;
  /** 所有换位都走轨迹线. */
  trails: boolean;
  /** 隐藏所有歌词换位的轨迹线，保留字的飞行与轨迹过渡. */
  hideTrails: boolean;
  /**
   * 轨迹过渡：段落之间也和段内换镜头一样在同一个光场里交接（整首歌编成一个场景单元），
   * 没有熄灯 / 闪白 / 拉焦 / 交叉渐变。改它会重新编译程序.
   */
  seamlessTransitions: boolean;
  /** 画框. */
  overlayFrame: boolean;
  /**
   * 仅显示歌词文字：只画歌词与字上的效果（点亮、光晕、闪点、十字爆闪、径迹、追字光斑），
   * 光场、烟雾、星空、线稿、浮尘、背景歌词、主题图标、画框与片尾卡的光都不画。字的明暗仍按光束算.
   */
  textOnly: boolean;
  /** 关键字着色（主题 wordColors）. */
  keywordColors: boolean;
  /** 主题图标（主题 lyricsIcons 画成线稿）. */
  themeIcons: boolean;
  /** 主题色占比, 0..1：0 = 香槟金光；越高光色越接近强调色、点亮 / 未唱的字越接近主色 / 次色. */
  themeColorMix: number;
  /** 画质. */
  renderQuality: LumiereRenderQuality;
}

export const DEFAULT_LUMIERE_TUNING: LumiereTuning = {
  render: { scale: 'global', antialias: 'global' },
  lightIntensity: 1,
  audioResponse: 1,
  fogDensity: 1,
  darkField: 0.75,
  moteAmount: 1,
  bloom: 1,
  textBloom: 1,
  unlitOpacity: 0.22,
  windowNeighbors: 2,
  decay: 1,
  echo: 1,
  fogOctaves: 5,
  lineArt: true,
  frontBokeh: true,
  trails: true,
  hideTrails: false,
  seamlessTransitions: true,
  overlayFrame: true,
  textOnly: false,
  keywordColors: true,
  themeIcons: true,
  themeColorMix: 0.3,
  renderQuality: 'full',
};

// Diorama's camera STYLE (calm/standard/chaotic) is not part of its tuning: like every other
// visualizer it follows theme.animationIntensity (the player-panel intensity chip / AI themes), so
// the theme system stays the single source of truth. The tuning only carries diorama-specific knobs.
/** The two mutually-exclusive shapes the point-cloud layer can take. */
export type DioramaGeometryMode = 'clouds' | 'corridor';

export interface DioramaGeometryVisibility {
  /** Parent switch: hides the whole point-cloud layer without discarding child preferences. */
  enabled: boolean;
  /**
   * 'clouds' = per-lyric point-cloud formations (the family switches below apply).
   * 'corridor' = one always-on point tunnel threaded along the flight path (families ignored).
   * The two never render together - picking one replaces the other.
   */
  mode: DioramaGeometryMode;
  /** Point-cloud cubes used by architectural formations. */
  strands: boolean;
  /** Open cylindrical point-cloud shells. */
  blobs: boolean;
  /** Triangular tetrahedron point-cloud crystals. */
  ribbons: boolean;
  /** Circular point-cloud loops. */
  rings: boolean;
}

export const DEFAULT_DIORAMA_GEOMETRY_VISIBILITY: DioramaGeometryVisibility = {
  enabled: true,
  mode: 'clouds',
  strands: true,
  blobs: true,
  ribbons: true,
  rings: true,
};

export const DIORAMA_PARTICLE_DENSITY_MIN = 96;

export const DIORAMA_PARTICLE_DENSITY_MAX = 1536;

export const DIORAMA_PARTICLE_DENSITY_STEP = 24;

// Background dust motes PER LINE of the resident window (see dioramaMoteField.ts). The motes sit in a
// shell around the flight axis, and the two axes are INDEPENDENT: 圆周 = motes around each ring, 径向 =
// how many layers across the shell's thickness (inner→outer). Motes-per-line = 圆周 x 径向; the window
// holds 8 lines, so MAX x MAX bounds the layer at 8*48*4 = 1536 points for low-end GPUs / OBS sources
// however far the sliders are dragged. Default 28 x 2 = 56 matches the old single-slider default.
export const DIORAMA_MOTE_CIRCUMFERENCE_MIN = 4;

export const DIORAMA_MOTE_CIRCUMFERENCE_MAX = 48;

export const DIORAMA_MOTE_RADIAL_MIN = 1;

export const DIORAMA_MOTE_RADIAL_MAX = 4;

export interface DioramaTuning {
  /** 分辨率与抗锯齿（#929）：默认跟随「动画与性能」里的全局挡位（utils/lyricRenderQuality.ts）。 */
  render: LyricRenderOverride;
  cameraSpeed: number;
  motionAmount: number;
  audioReactivity: number;
  geometryVisibility: DioramaGeometryVisibility;
  /** Number of points requested for each formation anchor; the renderer also enforces a global cap. */
  particleDensity: number;
  /** Spatial scale multiplier for each complete point-cloud formation. */
  particleScale: number;
  /** One soft gradient aura per point-cloud cluster, separate from lyric sung-glow. */
  particleGlowEnabled: boolean;
  particleGlowIntensity: number;
  showParticles: boolean;
  /** Background dust shell, two INDEPENDENT axes (motes-per-line = the product; field clamps to its cap):
   *  背景粒子·圆周密度 = motes around each ring, 背景粒子·径向密度 = layers across the shell thickness. */
  backgroundParticleCircumference: number;
  backgroundParticleRadial: number;
  /** 普通辉光跟唱: soft glow on the unit being sung. Independent toggle + strength. */
  glowEnabled: boolean;
  glowIntensity: number;
  /** 灵魂出窍跟唱: a ghost copy of the sung glyph drifts out of the text. Independent toggle + strength. */
  soulEnabled: boolean;
  soulIntensity: number;
  /** 当前字漂移: a plain ON/OFF sub-switch of 灵魂出窍. ON lets the glyph CURRENTLY being sung drift at the
   *  same 灵魂出窍强度 as every other glyph; OFF holds it perfectly registered (no doubling / reading
   *  obstruction) until it finishes, after which it detaches and flies like the rest. No strength of its
   *  own - it borrows soulIntensity. Only has a visible effect when soulEnabled. */
  soulActiveEnabled: boolean;
  /** 渐变跟唱: the line's fill progressively deepens with the sung progress. Independent toggle + strength. */
  gradientEnabled: boolean;
  gradientIntensity: number;
  /** 关键字着色: the theme's `wordColors` keywords (written by the AI theme from the song's lyrics) become
   *  the follow-sing TARGET colour of the units they cover - hidden until the singing reaches them, never
   *  a resting colour. Same source and matcher as every other visualizer. */
  keywordColoringEnabled: boolean;
}

export const DEFAULT_DIORAMA_TUNING: DioramaTuning = {
  render: { scale: 'global', antialias: 'global' },
  cameraSpeed: 1,
  motionAmount: 1,
  audioReactivity: 1,
  geometryVisibility: DEFAULT_DIORAMA_GEOMETRY_VISIBILITY,
  particleDensity: 576,
  particleScale: 1,
  particleGlowEnabled: true,
  particleGlowIntensity: 0.65,
  showParticles: true,
  backgroundParticleCircumference: 28,
  backgroundParticleRadial: 2,
  glowEnabled: true,
  glowIntensity: 1,
  soulEnabled: true,
  soulIntensity: 1,
  soulActiveEnabled: false,
  gradientEnabled: false,
  gradientIntensity: 1,
  keywordColoringEnabled: true,
};

export type MonetAudioStyle = 'bar' | 'line';

export type MonetPortraitSource = 'cover' | 'custom';

export interface MonetTuning {
  /** 分辨率与抗锯齿（#929）：默认跟随「动画与性能」里的全局挡位（utils/lyricRenderQuality.ts）。 */
  render: LyricRenderOverride;
  keywordColoringEnabled: boolean;
  showDescription: boolean;
  showAudioVisualization: boolean;
  audioStyle: MonetAudioStyle;
  fontScale: number;
  portraitSource: MonetPortraitSource;
  portraitOffsetX?: number;
  portraitStyle?: 'square' | 'rectangular';
  showPortraitDragHanger?: boolean;
}

export const DEFAULT_MONET_TUNING: MonetTuning = {
  render: { scale: 'global', antialias: 'global' },
  keywordColoringEnabled: true,
  showDescription: true,
  showAudioVisualization: true,
  audioStyle: 'bar',
  fontScale: 1.2,
  portraitSource: 'cover',
  portraitOffsetX: 0,
  portraitStyle: 'square',
  showPortraitDragHanger: true,
};

export interface CappellaEmojiImage {
  id: string;
  name: string;
  url: string;
}

export interface CappellaAvatarImage {
  id: string;
  name: string;
  url: string;
}

export interface MonetPortraitImage {
  id: string;
  name: string;
  url: string;
}
