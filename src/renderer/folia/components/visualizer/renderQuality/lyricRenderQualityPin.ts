import type { LyricRenderQuality } from '../../../types';
import { DEFAULT_LYRIC_RENDER_QUALITY } from '../../../utils/lyricRenderQuality';

// Folia 的版本从设置里读画质挡位，本项目没有这项设置，固定用默认值。
export const useLyricRenderQualityPin = (): LyricRenderQuality | null => null;
export const useGlobalLyricRenderQuality = (): LyricRenderQuality => DEFAULT_LYRIC_RENDER_QUALITY;
