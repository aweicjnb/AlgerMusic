import type { ThemeType } from '@/utils/theme';

import defaults from '../../main/set.json';
import type { LxMusicScriptConfig } from './lxMusic';

type WidenDefaults<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends (infer Item)[]
        ? WidenDefaults<Item>[]
        : T extends object
          ? { [Key in keyof T]: WidenDefaults<T[Key]> }
          : T;

export type SettingsData = Omit<
  WidenDefaults<typeof defaults>,
  'activeLxMusicApiId' | 'lxMusicScripts' | 'manualTheme'
> & {
  manualTheme: ThemeType;
  activeLxMusicApiId: string | null;
  lxMusicScripts: LxMusicScriptConfig[];
  tabletMode?: boolean;
};
