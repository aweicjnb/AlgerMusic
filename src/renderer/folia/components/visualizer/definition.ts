import type { MotionValue } from 'framer-motion';
import type {
    AudioBands,
    CappellaAvatarImage,
    CappellaEmojiImage,
    CappellaTuning,
    CadenzaTuning,
    ClassicTuning,
    CladdaghTuning,
    DioramaTuning,
    FumeTuning,
    Line,
    LumiereTuning,
    MonetPortraitImage,
    MonetTuning,
    PartitaTuning,
    PendoloTuning,
    SonnetTuning,
    SubtitleContentMode,
    SubtitleOverlayLayout,
    TemperaTuning,
    Theme,
    TiltTuning
} from '../../types';
import type { VisualizerBackgroundConfig } from './backgrounds/definition';

/**
 * An automix/crossfade blend handing the picture from the song on screen to the next one. The main
 * window only, and only for a style that says it draws one (`followsSongHandoff`): everywhere else
 * the song changes when the blend has settled, as it did.
 */
export interface VisualizerSongHandoff {
    /** How far the hand-off has come, 0..1: 0 until the blend is announced. */
    progress: MotionValue<number>;
    /** The incoming song as the props will name it once the blend settles. */
    seed: string | number;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    coverUrl?: string | null;
    /** The incoming song's theme, once it has come: the props keep the song on screen's until the blend settles. */
    theme: Theme;
    subtitleTheme?: Theme;
    /** The incoming song's lyrics (none until they load), its own lyric clock and line. */
    lines: Line[];
    currentTime: MotionValue<number>;
    currentLineIndex: number;
}

export interface VisualizerSharedProps {
    currentTime: MotionValue<number>;
    /** The song's length in seconds, 0 or absent while unknown; in a preview, the preview's length. Mod styles read it (getDuration). */
    duration?: number;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    subtitleTheme?: Theme;
    isDaylight?: boolean;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    coverUrl?: string | null;
    /**
     * Tempera canvas images shipped inline by the OBS overlay. That page is a separate browsing
     * context with no access to the app's IndexedDB, so when this is present the visualizer uses
     * it instead of reading the pool from storage.
     */
    temperaLayerImageAssets?: { id: string; name: string; url: string }[];
    seed?: string | number;
    /** A blend handing over to the next song, while it runs (see VisualizerSongHandoff). */
    songHandoff?: VisualizerSongHandoff | null;
    staticMode?: boolean;
    backgroundStaticMode?: boolean;
    visualizerOpacity?: number;
    background?: VisualizerBackgroundConfig;
    lyricsFontScale?: number;
    subtitleFontScale?: number;
    subtitleOverlayOpacity?: number;
    subtitleOverlayBackground?: boolean;
    subtitleUpcomingLyricsBlur?: boolean;
    showHarmonySubtitle?: boolean;
    harmonySubtitleBackground?: boolean;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    /** The shared bottom subtitle's rows (VisualizerSubtitleOverlay); it does not read subtitleContentMode. */
    subtitleOverlayLayout?: SubtitleOverlayLayout;
    paused?: boolean;
    onBack?: () => void;
    isPanelOpen?: boolean;
    alwaysShowBackButton?: boolean;
    onPlayerPanelGuideHotspotChange?: (isActive: boolean) => void;
    onLyricLineSeek?: (lyricTimeSec: number) => void;
    isPreviewMode?: boolean;
    /** A change the style on screen makes to its own tuning (a part dragged on the stage): the host saves it. A tuning.ts puts it on the prop its renderer calls. */
    onVisualizerTuningChange?: (patch: object) => void;
    classicTuning?: ClassicTuning;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    claddaghTuning?: CladdaghTuning;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    tiltTuning?: TiltTuning;
    dioramaTuning?: DioramaTuning;
    monetTuning?: MonetTuning;
    monetPortraitImage?: MonetPortraitImage | null;
    onMonetTuningChange?: (patch: Partial<MonetTuning>) => void;
    pendoloTuning?: PendoloTuning;
    sonnetTuning?: SonnetTuning;
    temperaTuning?: TemperaTuning;
    lumiereTuning?: LumiereTuning;
}
