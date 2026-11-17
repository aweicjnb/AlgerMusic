import { createMusicFallbackClient } from '@/services/musicFallback';

export default createMusicFallbackClient(import.meta.env.VITE_API_MUSIC);
