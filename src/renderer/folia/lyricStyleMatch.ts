import type { ILyric } from '@/types/music';

import { rhythmPace, type RhythmSummary } from '../services/rhythmAnalysis';
import { getLyricTags, type LyricMood, type LyricTopic } from './lyricTags';
import { FOLIA_STYLES, type FoliaStyle } from './styles';

type StyleProfile = {
  moods: Partial<Record<LyricMood, number>>;
  themes: Partial<Record<LyricTopic, number>>;
};

// Positive weights support the style; negative weights reserve it for a different atmosphere.
const STYLE_PROFILES: Record<Exclude<FoliaStyle, 'minions'>, StyleProfile> = {
  fume: { moods: { reflective: 1, nostalgic: 0.55 }, themes: { growth: 0.8, memory: 0.7 } },
  classic: {
    moods: { gentle: 0.6, hopeful: 0.65, reflective: 0.4 },
    themes: { companionship: 0.7, growth: 0.55 }
  },
  tilt: {
    moods: { sad: 0.65, gentle: 0.6, lonely: 0.5 },
    themes: { longing: 0.85, confession: 0.55 }
  },
  partita: {
    moods: { hopeful: 1, relieved: 0.55, joyful: 0.45 },
    themes: { growth: 1, journey: 0.5 }
  },
  claddagh: {
    moods: { nostalgic: 0.65, reflective: 0.55, determined: 0.45 },
    themes: { memory: 0.8, journey: 0.65 }
  },
  cadenza: {
    moods: { lonely: 0.65, nostalgic: 0.9, reflective: 0.55 },
    themes: { memory: 1, longing: 0.45 }
  },
  still: { moods: { quiet: 0.9, gentle: 0.55 }, themes: { companionship: 0.4, memory: 0.35 } },
  sonnet: {
    moods: { determined: 1, intense: 1, gentle: -0.55, quiet: -0.65 },
    themes: { struggle: 1, growth: 0.65 }
  },
  hanabi: {
    moods: { joyful: 1, playful: 0.7, hopeful: 0.6, intense: 0.45, sad: -1, lonely: -0.7 },
    themes: { celebration: 1, confession: 0.95 }
  },
  monet: {
    moods: { gentle: 1, relieved: 1, nostalgic: 0.65, sad: 0.2, intense: -0.55 },
    themes: { memory: 0.85, companionship: 1, confession: 0.9, separation: 0.3 }
  },
  pendolo: {
    moods: { reflective: 0.8, nostalgic: 0.5, quiet: 0.4 },
    themes: { time: 1, memory: 0.45 }
  },
  diorama: {
    moods: { intense: 0.7, determined: 0.65, reflective: 0.4 },
    themes: { journey: 1, struggle: 0.45 }
  },
  nebbia: {
    moods: { sad: 1, lonely: 1, quiet: 0.6, relieved: -0.65, joyful: -0.8 },
    themes: { separation: 1, longing: 1, night: 0.45 }
  },
  cappella: {
    moods: { playful: 1, gentle: 0.45, joyful: 0.55 },
    themes: { dialogue: 1, confession: 0.9, companionship: 0.65 }
  },
  lumiere: {
    moods: { quiet: 1, reflective: 0.75, lonely: 0.65, gentle: 0.4 },
    themes: { longing: 0.65, memory: 0.45, night: 0.5 }
  },
  tempera: {
    moods: { intense: 0.9, determined: 0.8, playful: 0.4 },
    themes: { struggle: 0.7, growth: 0.55 }
  },
  machi: {
    moods: { nostalgic: 0.55, quiet: 0.6, playful: 0.65 },
    themes: { night: 1, journey: 0.85, memory: 0.45 }
  }
};

const MOOD_WEIGHT = 3;
const MIN_MATCH_SCORE = 0.5;
const MAX_TIED_STYLES = 3;

// Pace affinity and preferred energy (0..1). Audio refines atmosphere; it does not infer emotion.
const RHYTHM_PROFILES: Record<
  Exclude<FoliaStyle, 'minions'>,
  { pace: [number, number, number]; energy: number }
> = {
  fume: { pace: [0.4, 0.7, 0], energy: 0.5 },
  classic: { pace: [0.6, 0.6, 0], energy: 0.4 },
  tilt: { pace: [0.8, 0.4, -0.4], energy: 0.35 },
  partita: { pace: [0.1, 0.8, 0.4], energy: 0.6 },
  claddagh: { pace: [0.2, 0.7, 0.2], energy: 0.55 },
  cadenza: { pace: [0.8, 0.3, -0.3], energy: 0.35 },
  still: { pace: [1, 0, -0.9], energy: 0.2 },
  sonnet: { pace: [-0.7, 0.3, 1], energy: 0.85 },
  hanabi: { pace: [-0.4, 0.5, 1], energy: 0.8 },
  monet: { pace: [0.9, 0.4, -0.4], energy: 0.35 },
  pendolo: { pace: [0.4, 0.9, 0.1], energy: 0.5 },
  diorama: { pace: [-0.3, 0.6, 0.9], energy: 0.75 },
  nebbia: { pace: [1, 0.1, -0.7], energy: 0.25 },
  cappella: { pace: [0.2, 0.8, 0.5], energy: 0.55 },
  lumiere: { pace: [1, 0.2, -0.6], energy: 0.25 },
  tempera: { pace: [-0.6, 0.4, 1], energy: 0.85 },
  machi: { pace: [0.1, 0.8, 0.5], energy: 0.55 }
};

export interface LyricStyleChoice {
  style: FoliaStyle;
  matchedTags: string[];
  rhythmApplied?: boolean;
}

function pickStyle<T extends { style: FoliaStyle }>(
  candidates: readonly T[],
  previous: FoliaStyle | undefined,
  random: () => number
): T {
  const choices =
    candidates.length > 1 ? candidates.filter(({ style }) => style !== previous) : candidates;
  return choices[Math.floor(random() * choices.length)];
}

export function matchLyricStyle(
  lyric: ILyric | string | undefined,
  previous?: FoliaStyle,
  random = Math.random,
  rhythm?: RhythmSummary
): LyricStyleChoice {
  const { moods, themes } = getLyricTags(lyric);
  const rhythmApplied =
    rhythm?.status === 'ready' && rhythm.bpm !== null && rhythm.confidence >= 0.62;
  const pace = rhythmApplied ? rhythmPace(rhythm.bpm!) : undefined;
  const ranked = FOLIA_STYLES.flatMap(({ value: style }) => {
    if (style === 'minions') return [];
    const profile = STYLE_PROFILES[style];
    const contributions = [
      ...moods.map(({ key, label, confidence }) => ({
        label,
        score: (profile.moods[key] ?? 0) * confidence * MOOD_WEIGHT
      })),
      ...themes.map(({ key, label, confidence }) => ({
        label,
        score: (profile.themes[key] ?? 0) * confidence
      }))
    ];
    if (pace && rhythm) {
      const audioProfile = RHYTHM_PROFILES[style];
      contributions.push(
        {
          label: { slow: '舒缓节奏', medium: '中速节奏', fast: '快节奏' }[pace],
          score: audioProfile.pace[{ slow: 0, medium: 1, fast: 2 }[pace]] * 1.6 * rhythm.confidence
        },
        {
          label: rhythm.energy >= 0.65 ? '有力伴奏' : rhythm.energy < 0.4 ? '轻柔伴奏' : '适中能量',
          score: (1 - Math.abs(rhythm.energy - audioProfile.energy) * 2) * 0.7 * rhythm.confidence
        }
      );
    }
    return [
      {
        style,
        contributions,
        score: contributions.reduce((total, tag) => total + tag.score, 0)
      }
    ];
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (best.score < MIN_MATCH_SCORE) {
    const { style } = pickStyle(ranked, previous, random);
    return { style, matchedTags: [], rhythmApplied };
  }

  // Shuffle only among close matches. A clear winner may suit two songs in a row.
  const margin = Math.min(0.35, best.score * 0.18);
  const candidates = ranked
    .filter(({ score }) => best.score - score <= margin)
    .slice(0, MAX_TIED_STYLES);
  const chosen = pickStyle(candidates, previous, random);
  const matchedTags = chosen.contributions
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ label }) => label);
  return { style: chosen.style, matchedTags, rhythmApplied };
}
