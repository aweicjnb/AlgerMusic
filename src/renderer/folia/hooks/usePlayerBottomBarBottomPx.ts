// Folia 的版本跟随它自己的底栏布局，本项目的翻译字幕固定在离底部一段距离的位置。
const SUBTITLE_BOTTOM_PX = 72;

export const usePlayerSubtitleBottomPx = (_isPlayerChromeHidden: boolean): number => SUBTITLE_BOTTOM_PX;
export const usePlayerSubtitleYieldsToDock = (): boolean => false;
