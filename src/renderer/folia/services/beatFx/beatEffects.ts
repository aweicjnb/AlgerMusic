/** Every effect id in the app, so code that plays one names it rather than spelling it. */
export const BEAT_EFFECT_IDS = {
    sonnetLensTear: 'sonnet.lensTear',
    dioramaRipple: 'diorama.ripple',
    pendoloDrumhead: 'pendolo.drumhead',
    pendoloGearBeats: 'pendolo.gearBeats',
    latentPulse: 'latent.pulse',
    hanabiBeatBursts: 'hanabi.beatBursts',
    hanabiBeatPulse: 'hanabi.beatPulse',
    temperaInkFlash: 'tempera.inkFlash',
    machiNeonPulse: 'machi.neonPulse',
    machiDrumRipple: 'machi.drumRipple',
    machiScreenFlash: 'machi.screenFlash',
    nebbiaDrizzleRide: 'nebbia.drizzleRide',
    nebbiaAquaBeat: 'nebbia.aquaBeat',
} as const;

/** The id a part plays under in the live strengths (beatFxLive.ts `getBeatEffectStrength`). */
export const beatEffectPartId = (id: string, part: string): string => `${id}:${part}`;

export const smartBeatActive = (settings: { mode: string }): boolean => settings.mode !== 'off';
