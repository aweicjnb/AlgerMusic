// Fullscreen renderers use these labels without starting Folia's i18next instance.
const MESSAGES: Record<string, string> = {
    'ui.waitingForMusic': '',
    'ui.noTrack': '未播放歌曲',
    'common.reset': '重置',
    'options.monetPortraitPositionEditing': '完成肖像位置调整',
    'options.monetPortraitPositionHint': '拖动调整肖像位置',
};

const t = (key: string) => MESSAGES[key] ?? key;

export const useTranslation = () => ({ t });
