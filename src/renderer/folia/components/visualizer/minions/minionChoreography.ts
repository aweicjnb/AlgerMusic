import { getMinionCueBoundary, type MinionCue } from './minionCues';

export const MINION_STAGE_WIDTH = 960;
export const MINION_STAGE_HEIGHT = 540;

// Positions are in the room illustration's coordinate system, with y at each actor's feet.
export const MINION_CAST = [
  { x: 264, y: 441, scale: 0.96, eyes: 2, height: 98 },
  { x: 402, y: 469, scale: 1.02, eyes: 1, height: 87 },
  { x: 543, y: 429, scale: 0.95, eyes: 2, height: 104 },
  { x: 689, y: 454, scale: 0.98, eyes: 1, height: 94 },
  { x: 155, y: 378, scale: 0.68, eyes: 1, height: 90 },
  { x: 214, y: 367, scale: 0.65, eyes: 2, height: 100 },
  { x: 676, y: 355, scale: 0.63, eyes: 2, height: 94 },
  { x: 764, y: 365, scale: 0.65, eyes: 1, height: 99 },
  { x: 858, y: 350, scale: 0.62, eyes: 2, height: 88 },
  { x: 130, y: 310, scale: 0.57, eyes: 2, height: 96 }
] as const;
export const MINION_HOLDERS = 4;

export interface ActorPose {
  x: number;
  y: number;
  turn: number;
  pace: number;
  step: number;
  jump: number;
  brace: number;
  reach: number;
  duck: number;
  glance: number;
  blink: number;
  signLift: number;
}

interface PropPose {
  x: number;
  y: number;
  height: number;
  spin: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const u = clamp(value);
  return u * u * (3 - 2 * u);
};
const lerp = (start: number, end: number, u: number) => start + (end - start) * u;
const bump = (time: number, center: number, width: number) =>
  1 - smooth(Math.abs(time - center) / width);
const PHASE = Math.PI * 2;
const PREP = 0.26;
const RELEASE = 0.22;

export const getMinionFrame = (cues: MinionCue[], lyricTime: number, reducedMotion: boolean) => {
  const time = reducedMotion ? 0 : Math.max(0, lyricTime);
  const chase = time % 6.8;
  const chaseWave = Math.sin((chase / 6.8) * PHASE - Math.PI / 2);
  const direction = Math.sin((chase / 6.8) * PHASE);
  const ballX = 230 + chaseWave * 100;
  const ball: PropPose = {
    x: ballX,
    y: 386,
    height: 12 + Math.abs(Math.sin(time * 6)) * 23,
    spin: time * -4.8
  };

  const fight = time % 7.5;
  const flight = smooth((fight - 1.9) / 1.08);
  const rebound = smooth((fight - 2.98) / 0.56);
  const collect = smooth((fight - 3.25) / 1.35);
  const retrieve = smooth((fight - 4.6) / 1.55);
  const throwerX = 676 + (collect - retrieve) * 126;
  const throwerY = 355 + (collect - retrieve) * 12;
  const windup = 14 + bump(fight, 1.9, 0.58) * 19;
  const pillow: PropPose = {
    x: lerp(
      lerp(lerp(697, 854, flight), 823, rebound),
      throwerX + 21,
      smooth((fight - 4.52) / 0.16)
    ),
    y: lerp(lerp(lerp(356, 351, flight), 373, rebound), throwerY + 1, retrieve),
    height: lerp(
      lerp(windup, 44, flight) + Math.sin(flight * Math.PI) * 36,
      8 + bump(fight, 4.88, 0.52) * 8 + retrieve * 6,
      rebound
    ),
    spin: flight * 5.8 + rebound * 1.25 - retrieve * 7.05
  };

  const boundary = getMinionCueBoundary(cues, lyricTime);
  const latest = cues[boundary - 1];
  const active = latest && lyricTime < latest.endTime ? latest : undefined;
  const upcoming = cues[boundary];
  const outgoing = active ? cues[boundary - 2] : latest;

  const actors = MINION_CAST.map(({ x, y }, index): ActorPose => {
    const cycle = time * 1.24 + index * 1.93;
    const pace = Math.abs(Math.cos(cycle));
    const pose: ActorPose = {
      x,
      y,
      turn: Math.sin(cycle * 0.65) * 0.25,
      pace: 0,
      step: cycle * 7,
      jump: 0,
      brace: 0,
      reach: 0,
      duck: 0,
      glance: Math.sin(cycle) * 0.55,
      blink: bump((time + index * 1.36) % 4.7, 4.5, 0.105),
      signLift: -1
    };

    if (index < MINION_HOLDERS) {
      const chasing = index < 2;
      pose.x += chasing ? chaseWave * (index === 0 ? 32 : 21) : Math.sin(cycle) * 15;
      pose.y += Math.sin(cycle * 0.78) * (chasing ? 7 : 12);
      pose.pace = chasing ? Math.abs(direction) : pace * 0.65;
      pose.turn = chasing ? direction * 0.87 : Math.cos(cycle) * 0.71;
      pose.glance = chasing ? Math.sign(ballX - pose.x) * 0.76 : pose.glance;
      pose.step = time * (chasing ? 18 : 13) + index * 2.4;

      const raising =
        upcoming?.holder === index ? smooth(1 - (upcoming.startTime - lyricTime) / PREP) : 0;
      const lowering =
        outgoing?.holder === index ? 1 - smooth((lyricTime - outgoing.endTime) / RELEASE) : 0;
      const isHolding = active?.holder === index;
      const transition = reducedMotion
        ? Number(isHolding)
        : Math.max(raising, lowering, Number(isHolding));
      pose.x = lerp(pose.x, x, transition);
      pose.y = lerp(pose.y, y, transition);
      pose.pace *= 1 - transition;
      pose.turn *= 1 - transition;
      pose.brace = reducedMotion ? 0 : Math.sin(raising * Math.PI) * 0.84;
      pose.glance = lerp(pose.glance, 0, transition);
      if (isHolding) {
        pose.signLift = reducedMotion
          ? 1
          : lerp(0.68, 1, smooth((lyricTime - active.startTime) / 0.11));
      } else if (!reducedMotion && Math.max(raising, lowering) > 0.02) {
        pose.signLift = Math.max(raising * 0.68, lowering);
      }
    } else if (index < 6) {
      pose.x = ballX - direction * (42 + (index - 4) * 52) - 26;
      pose.y += (index - 4) * 8;
      pose.turn = direction * 0.96;
      pose.glance = Math.sign(ballX - pose.x);
      pose.pace = Math.abs(direction) * 0.9 + 0.1;
      pose.step = time * 21 + index * 2.1;
    } else if (index === 6) {
      pose.turn = 0.57 - bump(fight, 5.37, 0.76) * 1.25;
      pose.brace = bump(fight, 1.6, 0.72) * 0.6;
      pose.reach = bump(fight, 1.95, 0.42);
      pose.pace = Math.max(bump(fight, 3.93, 0.68), bump(fight, 5.35, 0.79)) * 0.88;
      pose.step = time * 20;
      pose.glance = 0.85;
      pose.x = throwerX;
      pose.y = throwerY;
    } else if (index === 7) {
      pose.turn = -0.48;
      pose.duck = bump(fight, 2.56, 0.62);
      pose.x -= pose.duck * 18;
      pose.glance = pose.duck > 0.5 ? 0.9 : -0.9;
    } else if (index === 8) {
      pose.turn = -0.24;
      pose.duck = bump(fight, 3.04, 0.35) * 0.78;
      pose.jump = bump(fight, 3.19, 0.34) * 13;
      pose.x += bump(fight, 3.22, 0.5) * 19;
      pose.glance = -0.8;
    } else {
      pose.x += Math.sin(time * 1.06) * 31;
      pose.y += Math.cos(time * 1.06) * 5;
      pose.turn = 0.55;
      pose.glance = 0.8;
      pose.duck = bump(time % 5.9, 4.7, 0.55) * 0.8;
    }
    return pose;
  });
  return { actors, ball, pillow, active };
};
