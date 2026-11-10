import type { ILyric } from '@/types/music';

type Cue = { label: string; strong: RegExp; weak?: RegExp };

const MOODS = {
  sad: {
    label: '失落',
    strong:
      /心碎|难过|伤心|悲伤|泪流|泣不成声|哭到|泪水决堤|\bheartbroken\b|\bin tears\b|\bso sad\b/i,
    weak: /眼泪|哭泣|哭了|痛苦|委屈|遗憾|\bcrying\b|\btears\b/i
  },
  lonely: {
    label: '孤独',
    strong: /好孤单|孤独|寂寞|独自一人|没有人陪|只剩我一个人|\ball alone\b|\blonely\b/i,
    weak: /一个人|空荡荡|无人回应|\bempty room\b|\bon my own\b/i
  },
  gentle: {
    label: '温柔',
    strong:
      /好温柔|温柔地|你的温柔|轻轻拥抱|轻轻吻|依偎|安心入睡|\bhold me close\b|\bsoftly kiss\b/i,
    weak: /温柔|轻轻|安慰|守候|暖意|\btender\b|\bgentle\b/i
  },
  nostalgic: {
    label: '怀旧',
    strong:
      /回到从前|怀念从前|回忆往事|想起那年|当年的我们|\bback in those days\b|\bthe good old days\b/i,
    weak: /从前|那时候|旧时光|好多年前|老照片|\byesterday\b|\bused to be\b/i
  },
  relieved: {
    label: '释怀',
    strong:
      /释怀|终于放下|终于放手|终于释然|不再难过|不再等你|不再想你|原谅过去|\bmade peace\b|\bfinally let go\b|\bfinally moved on\b/i,
    weak: /放下了|学会放手|向前走|坦然|\bmoving on\b|\bletting go\b/i
  },
  determined: {
    label: '坚定',
    strong:
      /绝不放弃|决不退缩|不会认输|不服输|坚持到底|勇往直前|\bwon't give up\b|\bnever give up\b|\bwon't back down\b/i,
    weak: /坚持|咬紧牙关|迎着风|\bstand my ground\b|\bkeep going\b/i
  },
  intense: {
    label: '激烈',
    strong: /撕碎|怒吼|疯狂呐喊|燃烧殆尽|愤怒|\btear it down\b|\bfull of rage\b|\bscream out\b/i,
    weak: /燃烧|呐喊|尖叫|\bscreaming\b|\brage\b/i
  },
  joyful: {
    label: '欢快',
    strong:
      /快乐到飞起|纵情欢笑|尽情跳舞|开心地笑|欢呼雀跃|\bdance all night\b|\bshout for joy\b|\bso happy\b/i,
    weak: /欢笑|开心|快乐|喜悦|跳舞|\bcelebrate\b|\bjoy\b|\bhappy\b/i
  },
  playful: {
    label: '俏皮',
    strong: /和你捉迷藏|偷偷偷笑|做个鬼脸|逗你笑|\bplaying hide and seek\b|\bjust teasing\b/i,
    weak: /偷笑|俏皮|鬼脸|搞怪|\bgiggling\b|\bplayful\b/i
  },
  quiet: {
    label: '安静',
    strong: /万籁俱寂|静静地听|悄悄入睡|无声的夜|\bin the silence\b|\bthe quiet night\b/i,
    weak: /安静|寂静|静静|悄悄|\bsilence\b|\bquiet\b/i
  },
  reflective: {
    label: '沉思',
    strong:
      /想了很久|扪心自问|回望自己|终于明白|反复问自己|\basking myself\b|\blooking back on my life\b/i,
    weak: /思考|回望|追问|我在想|\bwonder why\b|\breflecting\b/i
  },
  hopeful: {
    label: '希望',
    strong: /明天会更好|迎来曙光|还有希望|相信未来|\bbetter days ahead\b|\bthere is hope\b/i,
    weak: /希望|期待|曙光|梦想|\bhope\b|\bbrighter day\b/i
  }
} satisfies Record<string, Cue>;

const THEMES = {
  confession: {
    label: '表白',
    strong:
      /想告诉你我爱你|喜欢上你|对你心动|爱上了你|我爱你|\bi fell for you\b|\bi love you\b|\bin love with you\b/i,
    weak: /告白|心动|喜欢你|\bcrush on you\b/i
  },
  separation: {
    label: '离别',
    strong:
      /失恋|分手|我们分开|离开了我|告别了你|说了再见|\bwe broke up\b|\bwe said goodbye\b|\byou left me\b/i,
    weak: /离别|告别|分离|再见|\bgoodbye\b|\bpart ways\b/i
  },
  longing: {
    label: '思念',
    strong: /好想你|想念你|思念你|多想再见你|等你回来|\bi miss you\b|\blonging for you\b/i,
    weak: /想起你|想你|思念|想念|\bthinking of you\b/i
  },
  memory: {
    label: '回忆',
    strong: /回忆里|翻开旧照片|记得那一年|回忆往事|\bi remember when\b|\bold photographs\b/i,
    weak: /回忆|记得|往事|旧照片|\bmemories\b|\bremember\b/i
  },
  companionship: {
    label: '陪伴',
    strong:
      /一直陪着你|陪你到老|在你身边|牵着你的手|\bby your side\b|\bhold your hand\b|\bi'm here for you\b/i,
    weak: /陪伴|一起走|并肩|\btogether\b/i
  },
  struggle: {
    label: '抗争',
    strong:
      /挣脱枷锁|打破束缚|对抗命运|绝不投降|\bbreak these chains\b|\bfight back\b|\bnever surrender\b/i,
    weak: /挣扎|反抗|枷锁|\bstruggle\b|\bfight\b/i
  },
  celebration: {
    label: '庆祝',
    strong: /举杯庆祝|为你喝彩|为这一刻干杯|今夜狂欢|\braise a glass\b|\blet's celebrate\b/i,
    weak: /干杯|欢聚|庆祝|派对|\bparty\b|\bcheers\b/i
  },
  growth: {
    label: '成长',
    strong: /慢慢长大|学会坚强|成为更好的自己|重新开始|\bstart over again\b|\blearn to grow\b/i,
    weak: /长大|蜕变|改变自己|\bgrowing up\b|\bnew beginning\b/i
  },
  journey: {
    label: '旅途',
    strong: /踏上旅途|一路远行|翻过山海|奔赴远方|\bon the road again\b|\bfar from home\b/i,
    weak: /远方|旅途|归途|行囊|\bjourney\b|\btravel\b/i
  },
  time: {
    label: '时光',
    strong: /时光倒流|岁月流逝|时间停在|时间的齿轮|\bturn back time\b|\btime stood still\b/i,
    weak: /时光|岁月|钟声|\bclock\b|\btime goes by\b/i
  },
  night: {
    label: '城市夜色',
    strong: /深夜的街道|城市的霓虹|雨夜街头|夜里的路灯|\bunder the city lights\b|\bneon streets\b/i,
    weak: /霓虹|路灯|夜班车|\bneon lights\b|\bstreetlights\b/i
  },
  dialogue: {
    label: '对话',
    strong: /我问你答|你问我答|你说.{1,22}我说|我说.{1,22}你说|\byou asked.{1,40}i said\b/i,
    weak: /你问|我答|你回答|\byou asked\b|\bi replied\b/i
  }
} satisfies Record<string, Cue>;

export type LyricMood = keyof typeof MOODS;
export type LyricTopic = keyof typeof THEMES;

type ScoredTag<T extends string> = { key: T; label: string; confidence: number };
export type LyricTags = {
  moods: ScoredTag<LyricMood>[];
  themes: ScoredTag<LyricTopic>[];
};

const CREDIT =
  /^(?:(?:作[词曲詞]|词曲|詞曲|词|詞|曲|编曲|編曲|演唱|制作人|製作人|混音|母带|母帶|监制|監製|和声|和聲|出品|录音|錄音|版权所有|版權|lyrics?|composer|arranger|producer)\s*[:：]|(?:lyrics?|written|composed|arranged|produced|performed)\s+by\b)/i;
const NEGATED =
  /(?:(?:不再|不要|不想再|并不|從不|从不|没那么|沒那麼|没有|沒有|不|没|沒)\s*|\b(?:not|never|no longer|don't|didn't|wasn't|isn't)\s+)$/i;
const TRADITIONAL = {
  愛: '爱',
  離: '离',
  開: '开',
  獨: '独',
  傷: '伤',
  懷: '怀',
  釋: '释',
  憶: '忆',
  淚: '泪',
  讓: '让',
  這: '这',
  從: '从',
  間: '间',
  過: '过',
  裡: '里',
  來: '来',
  還: '还',
  會: '会',
  變: '变',
  歡: '欢',
  樂: '乐',
  慶: '庆',
  揮: '挥',
  別: '别',
  戀: '恋',
  氣: '气',
  舊: '旧',
  鬆: '松',
  緊: '紧',
  終: '终',
  說: '说',
  問: '问',
  燈: '灯',
  聲: '声',
  靜: '静',
  飄: '飘',
  認: '认',
  輸: '输',
  堅: '坚',
  強: '强',
  歲: '岁',
  長: '长',
  風: '风',
  著: '着',
  牽: '牵',
  見: '见',
  鬥: '斗',
  脫: '脱',
  瘋: '疯',
  遠: '远',
  紛: '纷',
  點: '点',
  擁: '拥',
  並: '并',
  錄: '录',
  帶: '带',
  們: '们',
  單: '单',
  後: '后',
  沒: '没',
  麼: '么'
};
const TRADITIONAL_CHAR = new RegExp(`[${Object.keys(TRADITIONAL).join('')}]`, 'g');

const normalizeLines = (lines: unknown[]) => {
  const distinct = new Set<string>();
  for (const raw of lines) {
    if (typeof raw !== 'string') continue;
    const text = raw
      .normalize('NFKC')
      .trimStart()
      .replace(/^(?:\[[^\]]*\]\s*)+/, '')
      .replace(TRADITIONAL_CHAR, (char) => TRADITIONAL[char as keyof typeof TRADITIONAL])
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (text && !CREDIT.test(text)) distinct.add(text.toLowerCase());
  }
  return [...distinct];
};

function scoreTags<T extends string>(lines: string[], cues: Record<T, Cue>): ScoredTag<T>[] {
  const scored: ScoredTag<T>[] = [];
  for (const key of Object.keys(cues) as T[]) {
    const cue = cues[key];
    const evidence = new Map<string, number>();
    for (const [pattern, weight] of [
      [cue.strong, 3],
      [cue.weak, 1]
    ] as const) {
      if (!pattern) continue;
      const matcher = new RegExp(pattern.source, pattern.flags + 'g');
      for (const line of lines) {
        for (const match of line.matchAll(matcher)) {
          if (NEGATED.test(line.slice(0, match.index))) continue;
          // Repeating a chorus, or matching its weak synonym, must not inflate confidence.
          const phrase = match[0];
          if (
            weight === 1 &&
            [...evidence].some(([strong, score]) => score === 3 && strong.includes(phrase))
          )
            continue;
          evidence.set(phrase, Math.max(evidence.get(phrase) ?? 0, weight));
        }
      }
    }
    const score = [...evidence.values()].reduce((sum, weight) => sum + weight, 0);
    if (score >= 2) scored.push({ key, label: cue.label, confidence: Math.min(1, score / 5) });
  }
  return scored.sort((a, b) => b.confidence - a.confidence);
}

function analyze(lines: unknown[]): LyricTags {
  const text = normalizeLines(lines);
  return {
    moods: scoreTags(text, MOODS).slice(0, 3),
    themes: scoreTags(text, THEMES).slice(0, 3)
  };
}

const lyricTagCache = new WeakMap<ILyric, LyricTags>();

export function getLyricTags(lyric?: ILyric | string): LyricTags {
  if (typeof lyric === 'string') return analyze(lyric.split(/\r?\n/));
  if (!Array.isArray(lyric?.lrcArray) || !lyric.lrcArray.length) return { moods: [], themes: [] };
  const cached = lyricTagCache.get(lyric);
  if (cached) return cached;

  const original = analyze(lyric.lrcArray.map((line) => line?.text));
  // Use a supplied translation for a dimension the original text could not classify.
  const translation =
    original.moods.length && original.themes.length
      ? original
      : analyze(lyric.lrcArray.map((line) => line?.trText));
  const tags = {
    moods: original.moods.length ? original.moods : translation.moods,
    themes: original.themes.length ? original.themes : translation.themes
  };
  lyricTagCache.set(lyric, tags);
  return tags;
}
