// Folia 的版本接 i18next，这几种样式只用到一条文案。
const MESSAGES: Record<string, string> = {
    'ui.waitingForMusic': '',
};

const t = (key: string) => MESSAGES[key] ?? key;

export const useTranslation = () => ({ t });
