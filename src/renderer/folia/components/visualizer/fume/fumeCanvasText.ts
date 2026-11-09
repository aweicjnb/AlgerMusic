import { Theme } from '../../../types';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { colorWithAlpha, mixColors } from '../colorMix';
import { clearCanvasTextGlow, fillGlowText, setCanvasTextGlow } from '../../../utils/glowBlurQuantize';
import type { FumeBlock, RenderLineSlice, RenderSegmentSlice } from './fumeTypes';
import type { FumeBlockTiming } from './fumeBlockFrame';
import { clamp, easeInOutCubic, easeOutCubic, isCJK, mix, resolveDelayedGlowEnvelope } from './fumeMath';
import { resolvePrintedGraphemeCount, resolvePrintedGraphemeProgress, resolveVisualProgressWithCutoff } from './fumeReveal';
import { getActiveColor } from './fumeTextStyle';
import { buildFontSpec, resolveRenderLineOffset, resolveSegmentGlyphAdvance, resolveSegmentGlyphOffset } from './fumeTextMeasure';

// src/components/visualizer/fume/fumeCanvasText.ts
// Canvas 2D text drawing for fume: fonts, clipped text runs and the static block snapshots.

export const buildCanvasFont = (block: FumeBlock, theme: Theme) => {
    const fontFamily = resolveThemeFontStack(theme);
    return buildFontSpec(block.fontPx, block.variant, fontFamily, theme);
};

export const buildTextStyleKey = (
    fillStyle: string,
    shadowBlur: number,
    shadowColor: string,
) => `${fillStyle}|${shadowColor}|${shadowBlur.toFixed(3)}`;

// The live line's shadow blur in whole pixels, whatever the Linux switch (this is quantizeShadowBlur's
// switched-on branch). A radius that changes every frame makes Chromium build the shadowed glyphs
// again every frame, which was most of fume's frame on the main thread; whole pixels let it reuse them.
const roundShadowBlur = (px: number) => (Number.isFinite(px) ? Math.max(0, Math.round(px)) : 0);

// “唱到这个字”的动作（秒）：砸下 -> 落地闪白 -> 回弹稳定
const HIT_ATTACK = 0.09;
const HIT_SETTLE = 0.17;
const HIT_TOTAL = HIT_ATTACK + HIT_SETTLE;
const HIT_START_SCALE = 0.25;
const HIT_UNDERSHOOT = 0.03;
const HIT_DROP = 0.22;
const HIT_PEAK_SHADOW_ALPHA = 1;
// 落地时背后炸开的圆形柔光
const BLOOM_DURATION = 0.3;
const BLOOM_PEAK_ALPHA = 0.5;
// 拖长的字：超过这个时长就随时间呼吸
const LONG_NOTE_SECONDS = 0.5;
const LONG_NOTE_BREATH_HZ = 1.4;
const LONG_NOTE_ENVELOPE = 0.15;
const LONG_NOTE_SCALE = 0.04;
// 相邻的字跟着抬起，形成一股流动的波（高度相对字号，半径单位是字）
const WAVE_HEIGHT = 0.07;
const WAVE_RADIUS = 2.2;
// 只有逐句时间的歌，每个字的时间是估算的，动作太强反而显得对不上
const ESTIMATED_TIMING_STRENGTH = 0.45;

interface GlyphHit {
    reveal: number;
    scale: number;
    /** 向上偏移，相对字号 */
    lift: number;
    /** 接近纯白的程度 */
    flash: number;
    /** 长音呼吸，0..1 */
    breath: number;
}

const resolveGlyphHit = (sinceHit: number, hitEnd: number, strength: number, isLongNote: boolean): GlyphHit => {
    if (sinceHit <= 0) return { reveal: 0, scale: 1, lift: 0, flash: 0, breath: 0 };
    const attack = clamp(sinceHit / HIT_ATTACK, 0, 1);
    const settle = easeOutCubic((sinceHit - HIT_ATTACK) / HIT_SETTLE);
    // 下落是加速的，这样落地才有“砸”的感觉
    const fall = attack * attack;
    const undershoot = 1 - HIT_UNDERSHOOT * strength;
    let breath = 0;
    if (isLongNote) {
        const envelope = Math.min(
            clamp((sinceHit - HIT_TOTAL) / LONG_NOTE_ENVELOPE, 0, 1),
            clamp((hitEnd - sinceHit) / LONG_NOTE_ENVELOPE, 0, 1),
        );
        breath = envelope * (0.5 - 0.5 * Math.cos(2 * Math.PI * LONG_NOTE_BREATH_HZ * Math.max(sinceHit - HIT_TOTAL, 0)));
    }
    return {
        reveal: easeOutCubic(attack),
        scale: (sinceHit < HIT_ATTACK
            ? mix(1 + HIT_START_SCALE * strength, undershoot, fall)
            : mix(undershoot, 1, settle)) + breath * LONG_NOTE_SCALE * strength,
        lift: (1 - fall) * HIT_DROP * strength,
        flash: sinceHit < HIT_ATTACK ? fall : 1 - settle,
        breath,
    };
};

interface IndividualGlyph {
    grapheme: string;
    x: number;
    y: number;
    centerX: number;
    scale: number;
    fillStyle: string;
    shadowBlur: number;
    shadowColor: string;
}

interface GlyphBloom {
    x: number;
    y: number;
    radius: number;
    alpha: number;
    color: string;
}

// 点亮结束后，颜色和光晕交给拖尾的衔接时长（秒）
const GLYPH_TRAIL_HANDOFF = 0.2;
const GLYPH_PEAK_SHADOW_ALPHA = HIT_PEAK_SHADOW_ALPHA - 0.16;
// 整行光晕在一行开始和结束时的淡入淡出时长（秒）
const LINE_GLOW_FADE = 0.28;
// 高亮色变鲜艳后，整行光晕会把还没唱的字也染色，压低才能让唱到的字突出
const LINE_GLOW_STRENGTH = 0.45;

export const drawRenderTextRun = (
    context: CanvasRenderingContext2D,
    renderLine: RenderLineSlice,
    segment: RenderSegmentSlice,
    runStart: number,
    runEnd: number,
    baseX: number,
    baseY: number,
) => {
    if (!segment.text || runEnd <= runStart) {
        return;
    }

    const segmentRunStart = Math.max(runStart - segment.localStart, 0);
    const segmentRunEnd = Math.min(runEnd - segment.localStart, segment.measuredGlyphOffsets.length - 1);
    const clipLeft = segment.measuredGlyphOffsets[segmentRunStart] ?? (resolveRenderLineOffset(renderLine, runStart) - segment.x);
    const clipRight = segment.measuredGlyphOffsets[segmentRunEnd] ?? (resolveRenderLineOffset(renderLine, runEnd) - segment.x);
    const clipWidth = Math.max(clipRight - clipLeft, 0);
    if (clipWidth <= 0) {
        return;
    }

    context.save();
    context.beginPath();
    context.rect(
        baseX + segment.x + clipLeft,
        baseY - Math.max(clipWidth, 1) - 64,
        clipWidth,
        Math.max(128 + clipWidth * 2, 256),
    );
    context.clip();
    context.fillText(segment.text, baseX + segment.x, baseY);
    context.restore();
};

export const createStaticBlockSnapshot = (
    block: FumeBlock,
    theme: Theme,
    fillStyle: string,
    shadowBlur = 0,
    shadowColor = 'transparent',
    // 快照的光栅密度（每个世界单位几个像素）：舞台传进来的已经乘上了分辨率倍数（#929）；没传就是原来的默认。
    rasterScale = clamp(window.devicePixelRatio || 1, 1, 2),
) => {
    if (typeof document === 'undefined') {
        return null;
    }

    const padding = Math.ceil(Math.max(block.fontPx * 0.32, shadowBlur + block.fontPx * 0.08, 4));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((block.width + padding * 2) * rasterScale));
    canvas.height = Math.max(1, Math.ceil((block.height + padding * 2) * rasterScale));

    const context = canvas.getContext('2d');
    if (!context) {
        return null;
    }

    const baselineOffset = block.lineHeight * (isCJK(block.line.fullText) ? 0.52 : 0.5);
    context.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);
    context.font = buildCanvasFont(block, theme);
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = fillStyle;
    context.shadowBlur = shadowBlur;
    context.shadowColor = shadowColor;

    for (const renderLine of block.renderLines) {
        context.fillText(
            renderLine.text,
            renderLine.left + padding,
            renderLine.top + baselineOffset + padding,
        );
    }

    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    return { canvas, padding };
};

export interface FumeLiveBlockParams {
    time: number;
    theme: Theme;
    glowIntensity: number;
    activeGlowBoost: number;
    passedGlowBase: number;
    showPrintStamp: boolean;
}

/**
 * Draws a block that is printing or in its colour trail, glyph by glyph, in world coordinates under the
 * current transform: the line glow, each run's colour and glow, and the print stamps.
 */
export const drawFumeLiveBlock = (
    context: CanvasRenderingContext2D,
    block: FumeBlock,
    timing: FumeBlockTiming,
    { time, theme, glowIntensity, activeGlowBoost, passedGlowBase, showPrintStamp }: FumeLiveBlockParams,
) => {
    const {
        waitingOpacity, activeOpacity, transitionPassedStyle, baselineOffset, linePassCutoffTime,
        hasRevealCompleted, hasPassCutoffReached, lineDuration, colorTrailDuration,
    } = timing;
    const printedCount = resolvePrintedGraphemeCount(
        block.line,
        block.wordRanges,
        block.graphemes.length,
        time,
    );
    const totalGraphemeCount = block.graphemes.length;

    context.save();
    context.font = buildCanvasFont(block, theme);
    context.textAlign = 'left';
    context.textBaseline = 'middle';

    const hitStrength = block.line.estimatedWordTiming ? ESTIMATED_TIMING_STRENGTH : 1;
    const waveHead = resolvePrintedGraphemeProgress(block.line, block.wordRanges, totalGraphemeCount, time);
    const individualGlyphs: IndividualGlyph[] = [];
    const blooms: GlyphBloom[] = [];

    const isLineActive = time >= block.line.startTime && time <= linePassCutoffTime;
    // 一行开始和结束时淡入淡出，否则整行光晕和波浪会突然出现、突然消失
    const lineGlowFade = isLineActive
        ? easeInOutCubic(Math.min(
            clamp((time - block.line.startTime) / LINE_GLOW_FADE, 0, 1),
            clamp((linePassCutoffTime - time) / LINE_GLOW_FADE, 0, 1),
        ))
        : 0;
    if (isLineActive) {
        const lineProgress = resolveVisualProgressWithCutoff(
            block.line.startTime,
            lineDuration,
            time,
            linePassCutoffTime,
        );
        const lineGlowEnvelope = resolveDelayedGlowEnvelope(lineProgress, 0.8);
        const lineGlowAlpha = (
            (block.variant === 'hero' ? 0.16 : 0.12)
            + lineGlowEnvelope * (block.variant === 'hero' ? 0.26 : 0.2)
        ) * glowIntensity * lineGlowFade * LINE_GLOW_STRENGTH;
        const lineGlowBlur = (
            (block.variant === 'hero' ? 12 : 8)
            + lineGlowEnvelope * (block.fontPx * (block.variant === 'hero' ? 0.7 : 0.52))
        ) * glowIntensity * lineGlowFade;
        const lineGlowColor = colorWithAlpha(theme.accentColor, lineGlowAlpha);

        context.save();
        context.fillStyle = lineGlowColor;
        setCanvasTextGlow(
            context,
            roundShadowBlur(lineGlowBlur),
            colorWithAlpha(theme.accentColor, lineGlowAlpha * 1.35),
        );

        for (const renderLine of block.renderLines) {
            const glowBaseX = block.x + renderLine.left;
            const glowBaseY = block.y + renderLine.top + baselineOffset;

            for (const segment of renderLine.segments) {
                if (segment.text.trim().length === 0) {
                    continue;
                }

                fillGlowText(context, segment.text, glowBaseX + segment.x, glowBaseY);
            }
        }

        context.restore();
    }

    for (const renderLine of block.renderLines) {
        const baseX = block.x + renderLine.left;
        const baseY = block.y + renderLine.top + baselineOffset;

        for (const segment of renderLine.segments) {
            let runStart = -1;
            let runFillStyle = '';
            let runShadowBlur = 0;
            let runShadowColor = 'transparent';
            let runStyleKey = '';

            const flushRun = (segmentEnd: number) => {
                if (runStart < 0 || !runStyleKey || segmentEnd <= runStart) {
                    return;
                }

                const localStart = runStart - renderLine.start;
                const localEnd = segmentEnd - renderLine.start;
                const runText = renderLine.graphemes.slice(localStart, localEnd).join('');
                if (!runText || runText.trim().length === 0 && runFillStyle === '') {
                    runStart = -1;
                    runStyleKey = '';
                    return;
                }

                context.fillStyle = runFillStyle;
                setCanvasTextGlow(context, runShadowBlur, runShadowColor);
                drawRenderTextRun(
                    context,
                    renderLine,
                    segment,
                    localStart,
                    localEnd,
                    baseX,
                    baseY,
                );
                clearCanvasTextGlow(context);
                runStart = -1;
                runStyleKey = '';
            };

            for (let globalOffset = segment.start; globalOffset < segment.end; globalOffset += 1) {
                const graphemeIndex = globalOffset - renderLine.start;
                const grapheme = renderLine.graphemes[graphemeIndex]!;
                const rangeIndex = block.wordRangeIndexByOffset[globalOffset] ?? -1;
                const range = rangeIndex >= 0 ? block.wordRanges[rangeIndex]! : null;
                const colorRangeIndex = block.colorRangeIndexByOffset[globalOffset] ?? -1;
                const colorRange = colorRangeIndex >= 0 ? block.wordRanges[colorRangeIndex]! : range;
                const isPrinted = hasRevealCompleted || globalOffset < printedCount;
                const isFrontier = printedCount > 0
                    && globalOffset === printedCount
                    && printedCount < totalGraphemeCount
                    && !hasRevealCompleted
                    && !hasPassCutoffReached;

                let alpha = isPrinted
                    ? activeOpacity
                    : isFrontier
                        ? 0.82
                        : waitingOpacity;
                let shadowBlur = 0;
                let shadowColor = 'transparent';
                let fillStyle = colorWithAlpha(theme.primaryColor, alpha);
                let glyphScale = 1;
                let glyphLift = 0;

                if (range) {
                    const wordDuration = Math.max(range.word.endTime - range.word.startTime, 0.08);
                    const glyphCount = Math.max(range.end - range.start, 1);
                    const glyphIndexInRange = globalOffset - range.start;
                    const glyphTiming = range.word.syllables?.length
                        ? range.graphemeTimings[Math.min(glyphIndexInRange, Math.max(range.graphemeTimings.length - 1, 0))]
                        : undefined;
                    const glyphStartTime = glyphTiming?.startTime ?? (range.word.startTime + (glyphIndexInRange / glyphCount) * wordDuration);
                    const glyphEndTime = glyphTiming?.endTime ?? (range.word.startTime + ((glyphIndexInRange + 1) / glyphCount) * wordDuration);
                    const glyphDuration = Math.max(glyphEndTime - glyphStartTime, 0.001);
                    // 逐句歌词的字时长是估算的，看不出哪个字真的拖长
                    const isLongNote = !block.line.estimatedWordTiming && glyphDuration >= LONG_NOTE_SECONDS;
                    const glyphHitEnd = isLongNote ? glyphDuration : HIT_TOTAL;
                    const activeColor = getActiveColor((colorRange ?? range).word.text, theme);
                    const glyphTrailStart = glyphStartTime + glyphHitEnd;
                    const glyphPeakShadowBlur = (4 + block.fontPx * 0.22) * activeGlowBoost;
                    const colorTrailPhase = resolveVisualProgressWithCutoff(
                        glyphTrailStart,
                        colorTrailDuration,
                        time,
                        linePassCutoffTime,
                    );
                    const colorTrailProgress = Math.pow(colorTrailPhase, 1.35);

                    if (hasPassCutoffReached) {
                        alpha = mix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress);
                        fillStyle = mixColors(activeColor, theme.primaryColor, 0.18 + colorTrailProgress * 0.82, alpha);
                        shadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35) * passedGlowBase * transitionPassedStyle.glowMultiplier;
                        shadowColor = colorWithAlpha(
                            mixColors(activeColor, theme.primaryColor, 0.55 + colorTrailProgress * 0.45),
                            transitionPassedStyle.shadowAlphaBase + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail,
                        );
                    } else if (time < range.word.startTime) {
                        alpha = waitingOpacity;
                        fillStyle = colorWithAlpha(theme.primaryColor, alpha);
                    } else if (time <= glyphTrailStart) {
                        const sinceHit = time - glyphStartTime;
                        const hit = resolveGlyphHit(sinceHit, glyphHitEnd, hitStrength, isLongNote);
                        const flash = hit.flash * hitStrength;
                        alpha = mix(waitingOpacity, activeOpacity, hit.reveal);
                        fillStyle = mixColors(
                            mixColors(theme.primaryColor, activeColor, hit.reveal),
                            '#ffffff',
                            flash,
                            alpha,
                        );
                        shadowBlur = (glyphPeakShadowBlur
                            + (block.fontPx * 0.5 * activeGlowBoost) * flash
                            + (block.fontPx * 0.2 * activeGlowBoost) * hit.breath) * hit.reveal;
                        shadowColor = colorWithAlpha(
                            mixColors(activeColor, '#ffffff', flash * 0.4),
                            mix(GLYPH_PEAK_SHADOW_ALPHA, HIT_PEAK_SHADOW_ALPHA, flash) * hit.reveal,
                        );
                        glyphScale = hit.scale;
                        glyphLift = hit.lift;

                        const bloomStart = HIT_ATTACK * 0.6;
                        if (sinceHit >= bloomStart && sinceHit <= bloomStart + BLOOM_DURATION && grapheme.trim().length > 0) {
                            const bloomProgress = (sinceHit - bloomStart) / BLOOM_DURATION;
                            blooms.push({
                                x: baseX + segment.x + resolveSegmentGlyphOffset(segment, globalOffset) + resolveSegmentGlyphAdvance(segment, globalOffset) * 0.5,
                                y: baseY,
                                radius: block.fontPx * (0.55 + 0.95 * easeOutCubic(bloomProgress)),
                                alpha: BLOOM_PEAK_ALPHA * hitStrength * Math.pow(1 - bloomProgress, 1.6),
                                color: activeColor,
                            });
                        }
                    } else {
                        // 从点亮的峰值连续过渡到拖尾，避免颜色和光晕在交接时跳一下
                        const trailHandoff = easeInOutCubic(clamp((time - glyphTrailStart) / GLYPH_TRAIL_HANDOFF, 0, 1));
                        const trailShadowBlur = (2 + block.fontPx * 0.1) * (1 - colorTrailProgress * 0.35) * passedGlowBase * transitionPassedStyle.glowMultiplier;
                        const trailShadowAlpha = transitionPassedStyle.shadowAlphaBase + (1 - colorTrailProgress) * transitionPassedStyle.shadowAlphaTrail;
                        alpha = mix(activeOpacity, transitionPassedStyle.opacity, colorTrailProgress);
                        fillStyle = mixColors(activeColor, theme.primaryColor, (0.18 + colorTrailProgress * 0.82) * trailHandoff, alpha);
                        shadowBlur = mix(glyphPeakShadowBlur, trailShadowBlur, trailHandoff);
                        shadowColor = colorWithAlpha(
                            mixColors(activeColor, theme.primaryColor, (0.55 + colorTrailProgress * 0.45) * trailHandoff),
                            mix(GLYPH_PEAK_SHADOW_ALPHA, trailShadowAlpha, trailHandoff),
                        );
                    }

                    if (showPrintStamp && grapheme.trim().length > 0) {
                        const glyphWindowDuration = Math.max(wordDuration / glyphCount, 0.04);
                        const activationLeadDuration = clamp(
                            Math.min(glyphWindowDuration * 0.86, lineDuration * 0.16),
                            0.055,
                            block.variant === 'hero' ? 0.2 : 0.16,
                        );
                        const activationReleaseDuration = activationLeadDuration * 0.42;
                        const activationWindowStart = glyphTrailStart - activationLeadDuration;
                        const activationWindowEnd = glyphTrailStart + activationReleaseDuration;
                        const glyphAdvance = resolveSegmentGlyphAdvance(segment, globalOffset);
                        const stampProgress = resolveVisualProgressWithCutoff(
                            activationWindowStart,
                            activationWindowEnd - activationWindowStart,
                            time,
                            linePassCutoffTime,
                        );

                        if (stampProgress > 0 && stampProgress < 1) {
                            const glyphTrailPhase = resolveVisualProgressWithCutoff(
                                glyphTrailStart,
                                Math.max(activationWindowEnd - glyphTrailStart, 0.001),
                                time,
                                linePassCutoffTime,
                            );
                            const isDropping = glyphTrailPhase <= 0;
                            const dropProgress = isDropping
                                ? easeOutCubic(
                                    resolveVisualProgressWithCutoff(
                                        activationWindowStart,
                                        Math.max(glyphTrailStart - activationWindowStart, 0.001),
                                        time,
                                        linePassCutoffTime,
                                    ),
                                )
                                : 1;
                            const fadeProgress = isDropping
                                ? 0
                                : easeInOutCubic(glyphTrailPhase);
                            const blockPulse = isDropping
                                ? mix(0.18, 1, Math.pow(dropProgress, 0.78))
                                : Math.pow(1 - fadeProgress, 1.2);
                            const glyphVisualWidth = Math.max(
                                glyphAdvance * 0.88,
                                isCJK(grapheme) ? block.fontPx * 0.56 : block.fontPx * 0.38,
                            );
                            const blockCenterX = baseX + segment.x + resolveSegmentGlyphOffset(segment, globalOffset) + glyphAdvance * 0.5;
                            const dropDistance = block.lineHeight * (block.variant === 'hero' ? 0.24 : 0.2);
                            const activationBlockAlpha = blockPulse * (block.variant === 'hero' ? 0.82 : 0.72);
                            const activationBlockWidth = glyphVisualWidth + block.fontPx * (block.variant === 'hero' ? 0.18 : 0.12);
                            const activationBlockHeight = block.fontPx * (block.variant === 'hero' ? 0.72 : 0.62);
                            const activationBlockY = baseY
                                - block.fontPx * 0.38
                                - mix(dropDistance, 0, dropProgress);
                            const activationBlockBlur = (8 + block.fontPx * 0.24) * blockPulse * activeGlowBoost;

                            if (activationBlockWidth > 0) {
                                const blockLeft = blockCenterX - activationBlockWidth * 0.5;
                                context.save();
                                context.fillStyle = colorWithAlpha(activeColor, activationBlockAlpha);
                                context.shadowBlur = activationBlockBlur;
                                context.shadowColor = colorWithAlpha(activeColor, 0.56 * blockPulse);
                                context.fillRect(
                                    blockLeft,
                                    activationBlockY - activationBlockHeight * 0.5,
                                    activationBlockWidth,
                                    activationBlockHeight,
                                );
                                context.restore();
                            }
                        }
                    }
                }

                if (alpha <= 0.002) {
                    flushRun(globalOffset);
                    continue;
                }

                const waveDistance = Math.abs(globalOffset + 0.5 - waveHead);
                const waveLift = lineGlowFade > 0 && waveDistance < WAVE_RADIUS
                    ? Math.cos((Math.PI * waveDistance) / (2 * WAVE_RADIUS)) ** 2 * WAVE_HEIGHT * hitStrength * lineGlowFade
                    : 0;
                const totalLift = (glyphLift + waveLift) * block.fontPx;

                if (grapheme.trim().length > 0 && (Math.abs(glyphScale - 1) > 0.002 || totalLift > 0.2)) {
                    // 需要单独位移缩放的字不并入整段绘制，等这一行的文字画完后再画在上面
                    flushRun(globalOffset);
                    const glyphX = baseX + segment.x + resolveSegmentGlyphOffset(segment, globalOffset);
                    individualGlyphs.push({
                        grapheme,
                        x: glyphX,
                        y: baseY - totalLift,
                        centerX: glyphX + resolveSegmentGlyphAdvance(segment, globalOffset) * 0.5,
                        scale: glyphScale,
                        fillStyle,
                        shadowBlur: roundShadowBlur(shadowBlur),
                        shadowColor,
                    });
                    continue;
                }

                // Whole pixels: a blur radius that changes every frame leaks shared memory in
                // Chromium's glyph cache (Lab > Fix lyric animation freeze on Linux) and redraws
                // the shadowed glyphs every frame. See utils/glowBlurQuantize.ts.
                shadowBlur = roundShadowBlur(shadowBlur);
                const styleKey = buildTextStyleKey(fillStyle, shadowBlur, shadowColor);
                if (runStart < 0) {
                    runStart = globalOffset;
                    runFillStyle = fillStyle;
                    runShadowBlur = shadowBlur;
                    runShadowColor = shadowColor;
                    runStyleKey = styleKey;
                    continue;
                }

                if (styleKey !== runStyleKey) {
                    flushRun(globalOffset);
                    runStart = globalOffset;
                    runFillStyle = fillStyle;
                    runShadowBlur = shadowBlur;
                    runShadowColor = shadowColor;
                    runStyleKey = styleKey;
                }
            }

            flushRun(segment.end);
        }
    }

    for (const bloom of blooms) {
        const gradient = context.createRadialGradient(bloom.x, bloom.y, 0, bloom.x, bloom.y, bloom.radius);
        gradient.addColorStop(0, colorWithAlpha(bloom.color, bloom.alpha));
        gradient.addColorStop(0.45, colorWithAlpha(bloom.color, bloom.alpha * 0.4));
        gradient.addColorStop(1, colorWithAlpha(bloom.color, 0));
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(bloom.x, bloom.y, bloom.radius, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }

    for (const glyph of individualGlyphs) {
        context.save();
        context.translate(glyph.centerX, glyph.y);
        context.scale(glyph.scale, glyph.scale);
        context.translate(-glyph.centerX, -glyph.y);
        context.fillStyle = glyph.fillStyle;
        setCanvasTextGlow(context, glyph.shadowBlur, glyph.shadowColor);
        context.fillText(glyph.grapheme, glyph.x, glyph.y);
        clearCanvasTextGlow(context);
        context.restore();
    }

    context.restore();
};
