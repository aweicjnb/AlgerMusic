import type { ILyricText } from '@/types/music';

import type { Line, Theme, Word } from './types';
import { buildTimedWords, estimateLrcLineEndTime } from './utils/lyrics/estimatedLineTiming';
import { ensureLyricLinesRenderHints } from './utils/lyrics/renderHints';

// 把本播放器的歌词和封面颜色转换成 Folia 的格式。这个文件不引用 React。

/** 一句歌词的开始时间（秒）。startTime 单位是毫秒，个别来源只有 lrcTimeArray。 */
const lineStartSeconds = (item: ILyricText, index: number, times: number[]): number => (
    typeof item.startTime === 'number' && item.startTime >= 0 ? item.startTime / 1000 : times[index] ?? 0
);

export const buildFoliaLines = (items: ILyricText[], times: number[]): Line[] => {
    const starts = items.map((item, index) => lineStartSeconds(item, index, times));
    return ensureLyricLinesRenderHints(items.map((item, index) => {
        const startTime = starts[index];
        const text = item.text ?? '';
        const lineEnd = item.duration && item.duration > 0
            ? startTime + item.duration / 1000
            : estimateLrcLineEndTime(text, startTime, starts[index + 1]);
        const hasWordTiming = Boolean(item.words && item.words.length > 0);
        const words: Word[] = item.words && item.words.length > 0
            ? item.words.map(word => ({
                text: word.space ? `${word.text} ` : word.text,
                startTime: word.startTime / 1000,
                endTime: (word.startTime + word.duration) / 1000,
            }))
            // 普通 LRC 没有逐字时间，用 Folia 的估算把一句平均分给每个字。
            : text.trim() ? buildTimedWords(text, startTime, lineEnd) : [];
        const endTime = Math.max(lineEnd, words[words.length - 1]?.endTime ?? lineEnd);
        return {
            words,
            startTime,
            endTime,
            fullText: text,
            translation: item.trText || undefined,
            id: `${index}`,
            estimatedWordTiming: !hasWordTiming,
        };
    }));
};

/** 当前时间所在的歌词行，第一句之前返回 -1。 */
export const findFoliaLineIndex = (lines: Line[], time: number): number => {
    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (lines[middle].startTime <= time) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return found;
};

type Rgb = [number, number, number];

const parseColor = (color?: string): Rgb | null => {
    if (!color) return null;
    const rgb = color.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    const hex = color.match(/^#([0-9a-f]{6})/i);
    if (hex) {
        const value = Number.parseInt(hex[1], 16);
        return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }
    return null;
};

const mix = (from: Rgb, to: Rgb, amount: number): string => {
    const channel = (index: number) => Math.round(from[index] + (to[index] - from[index]) * amount);
    return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
};

const FALLBACK_ACCENT = 'rgb(127, 220, 255)';

/** 把封面主色调成足够饱和、足够亮的高亮色；封面接近黑白时用默认的浅蓝。 */
const vividAccent = ([r, g, b]: Rgb): string => {
    const red = r / 255, green = g / 255, blue = b / 255;
    const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
    const delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    if (saturation < 0.12) return FALLBACK_ACCENT;
    const hue = max === red
        ? ((green - blue) / delta + 6) % 6
        : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    const outLightness = Math.min(Math.max(lightness, 0.62), 0.72);
    const outSaturation = Math.max(saturation, 0.78);
    const chroma = (1 - Math.abs(2 * outLightness - 1)) * outSaturation;
    const x = chroma * (1 - Math.abs((hue % 2) - 1));
    const m = outLightness - chroma / 2;
    const [rr, gg, bb] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
    return `rgb(${Math.round((rr + m) * 255)}, ${Math.round((gg + m) * 255)}, ${Math.round((bb + m) * 255)})`;
};

/** 深色背景带一点封面主色，高亮色取封面主色的鲜艳版。 */
export const buildFoliaTheme = (primaryColor?: string, fontFamily?: string): Theme => {
    const cover = parseColor(primaryColor) ?? [120, 130, 150];
    // 设置里的字体是逗号分隔的字体名，默认值 system-ui 表示不指定，继续用动画自己的字体
    const fontFamilyStack = fontFamily && fontFamily !== 'system-ui'
        ? fontFamily.split(',').map(name => name.trim()).filter(Boolean)
        : undefined;
    return {
        name: 'alger',
        backgroundColor: mix(cover, [9, 9, 11], 0.84),
        primaryColor: '#fafafa',
        accentColor: vividAccent(cover),
        secondaryColor: '#b4b4bd',
        fontStyle: 'sans',
        fontFamilyStack,
        animationIntensity: 'normal',
    };
};
