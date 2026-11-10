import type { Line } from '../../types';

export const INTERLUDE_FULL_TEXT = '......';

export const isInterludeLine = (line: Pick<Line, 'fullText'>): boolean => line.fullText === INTERLUDE_FULL_TEXT;
