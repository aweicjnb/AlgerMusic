import type { Line } from '../../../types';
import { buildLineGraphemeTimeline } from '../../../utils/lyrics/graphemeTiming';
import { segmentTextWords } from '../../../utils/lyrics/wordSegmentation';
import { createVisualizerRng } from '../visualizerSeedHash';

interface SignTiming {
  text: string;
  startTime: number;
  endTime: number;
}

export interface MinionCue extends SignTiming {
  holder: number;
}

const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const LATIN_WORD = /^[\p{Script=Latin}\p{M}\p{N}'’-]+$/u;

const getLineSigns = (line: Line): SignTiming[] => {
  const graphemes = buildLineGraphemeTimeline(line);
  const timed: (SignTiming & { offset: number; wordIndex?: number })[] = [];
  let lastSpoken: (typeof timed)[number] | undefined;
  let offset = 0;
  for (const { char, startTime, endTime, wordIndex } of graphemes) {
    const item = { text: char, startTime, endTime, offset, wordIndex };
    offset += char.length;
    if (HAS_LETTER_OR_NUMBER.test(char)) {
      lastSpoken = item;
    } else if (wordIndex !== undefined && lastSpoken?.wordIndex === wordIndex) {
      // Spaces attached to a timed word by the adapter should not shorten its sign.
      lastSpoken.endTime = Math.max(lastSpoken.endTime, endTime);
    }
    timed.push(item);
  }
  const words = segmentTextWords(line.fullText);
  let cursor = 0;

  return words.flatMap(({ index, segment }) => {
    const start = cursor;
    while (cursor < timed.length && timed[cursor].offset < index + segment.length) cursor += 1;
    const letters = timed
      .slice(start, cursor)
      .filter(({ text }) => HAS_LETTER_OR_NUMBER.test(text));
    if (!letters.length) return [];
    if (!LATIN_WORD.test(segment)) {
      return letters.map(({ text, startTime, endTime }) => ({ text, startTime, endTime }));
    }
    return [
      {
        text: segment,
        startTime: letters[0].startTime,
        endTime: letters[letters.length - 1].endTime
      }
    ];
  });
};

export const buildMinionCues = (lines: Line[], seed: string, holderCount: number): MinionCue[] => {
  const random = createVisualizerRng(seed);
  const signs = lines
    .flatMap(getLineSigns)
    .filter(({ startTime, endTime }) => Number.isFinite(startTime) && endTime > startTime)
    .sort((a, b) => a.startTime - b.startTime);
  let holder = Math.floor(random() * holderCount);
  let previous: MinionCue | undefined;

  return signs.flatMap((sign, index) => {
    const endTime = Math.min(sign.endTime, signs[index + 1]?.startTime ?? Infinity);
    if (endTime <= sign.startTime) return [];
    const rapid =
      previous &&
      sign.startTime - previous.endTime < 0.18 &&
      Math.min(previous.endTime - previous.startTime, endTime - sign.startTime) < 0.38;
    const choices = rapid
      ? [holder - 1, holder + 1].filter((index) => index >= 0 && index < holderCount)
      : Array.from({ length: holderCount }, (_, index) => index).filter(
          (index) => index !== holder
        );
    holder = choices[Math.floor(random() * choices.length)];
    previous = { ...sign, endTime, holder };
    return [previous];
  });
};

export const getMinionCueBoundary = (cues: MinionCue[], time: number): number => {
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cues[middle].startTime <= time) low = middle + 1;
    else high = middle;
  }
  return low;
};

export const findMinionCue = (cues: MinionCue[], time: number): number => {
  const index = getMinionCueBoundary(cues, time) - 1;
  return index >= 0 && time < cues[index].endTime ? index : -1;
};
