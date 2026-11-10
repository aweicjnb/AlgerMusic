import type { BeatFxEvent } from './clock';

// The host supplies a live spectrum. Folia's model-based beat and stem tracks are optional.
const noEvents: readonly BeatFxEvent[] = [];
const noIntensities = { beat: 0, downbeat: 0 };
const noFires = { beats: 0, downbeats: 0 };
const noTrack: { key: string | null; time: number | null } = { key: null, time: null };

export const getBeatEffectStrength = (_id: string): number => 0;
export const isBeatEffectPlaying = (_id: string): boolean => false;
export const getBeatFxEvents = () => noEvents;
export const getBeatFxIntensities = () => noIntensities;
export const getBeatFxFiredCounts = () => noFires;
export const getBeatFxHeard = () => noTrack;
export const getBeatFxLastBeat = (): BeatFxEvent | null => null;
export const getBeatFxLastDownbeat = (): BeatFxEvent | null => null;
export const getBeatFxBeatPeriod = () => 0;
export const getBeatFxTrackScale = () => 1;
export const getBeatFxRotationSign = () => 1;
export const isBeatFxReady = () => false;
export const isBeatFxHearing = () => false;
