/** @jsxImportSource react */
import './minions.css';

import { useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { logPlayback, playbackErrorFields } from '@/utils/playbackLog';

import type { VisualizerSharedProps } from '../definition';
import { MINION_HOLDERS } from './minionChoreography';
import { buildMinionCues, findMinionCue } from './minionCues';
import { MinionRoomRuntime } from './minionRoomRuntime';
import roomUrl from './room.jpg';

let minionSceneSequence = 0;

export default function VisualizerMinions({
  lines,
  currentTime,
  seed,
  staticMode,
  showText = true
}: VisualizerSharedProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<(() => void) | null>(null);
  const [fallback, setFallback] = useState(false);
  const reducedMotion = useReducedMotion() === true || staticMode === true;
  const cues = useMemo(
    () => (showText ? buildMinionCues(lines, String(seed), MINION_HOLDERS) : []),
    [lines, seed, showText]
  );
  const inputs = useRef({ cues, reducedMotion });
  const subscribe = useCallback(
    (notify: () => void) => currentTime.on('change', notify),
    [currentTime]
  );
  const getCueIndex = useCallback(
    () => findMinionCue(cues, currentTime.get()),
    [cues, currentTime]
  );
  const active = cues[useSyncExternalStore(subscribe, getCueIndex)];

  useEffect(() => {
    inputs.current = { cues, reducedMotion };
    redraw.current?.();
  }, [cues, reducedMotion]);

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const startedAt = performance.now();
    const visualizerId = `minions-${++minionSceneSequence}`;
    const scene = { visualizerId, style: 'minions', backend: 'webgl2' };
    let stage = 'resources';
    let contextGeneration = 0;
    const failedStages = new Set<string>();
    const failureFields = () => ({
      ...scene,
      stage,
      contextGeneration,
      width: surface.width,
      height: surface.height,
      positionSeconds: currentTime.get()
    });
    const reportFailure = (error: unknown) => {
      if (failedStages.has(stage)) return;
      failedStages.add(stage);
      logPlayback('visualizer.render-error', { ...failureFields(), ...playbackErrorFields(error) });
    };
    logPlayback('visualizer.init', scene);

    let contextCreationError = false;
    const onContextCreationError = () => {
      contextCreationError = true;
    };
    surface.addEventListener('webglcontextcreationerror', onContextCreationError);
    let runtime: MinionRoomRuntime;
    try {
      runtime = new MinionRoomRuntime(surface, {
        setSetupStage: (setupStage) => {
          stage = setupStage;
        },
        shaderError: (status) => {
          const key = `shader:${stage}`;
          if (failedStages.has(key)) return;
          failedStages.add(key);
          console.warn('[Minions] WebGL shader error', stage, status);
          logPlayback('visualizer.shader-error', { ...failureFields(), ...status });
        }
      });
    } catch (error) {
      console.warn('[Minions] WebGL scene could not start', error);
      logPlayback('visualizer.fallback', {
        ...failureFields(),
        reason: 'init-error',
        contextCreationError,
        elapsedMs: Math.round(performance.now() - startedAt),
        ...playbackErrorFields(error)
      });
      setFallback(true);
      return;
    } finally {
      surface.removeEventListener('webglcontextcreationerror', onContextCreationError);
    }
    logPlayback('visualizer.initialized', {
      ...scene,
      elapsedMs: Math.round(performance.now() - startedAt)
    });

    let lost = false;
    let prepared = false;
    let disposed = false;
    let contextLostAt: number | undefined;
    let firstDraw = true;
    let drawStartedAt = startedAt;
    const draw = () => {
      if (lost || !prepared) return;
      const { cues, reducedMotion } = inputs.current;
      stage = 'draw';
      try {
        if (runtime.draw(cues, currentTime.get(), reducedMotion) && firstDraw) {
          firstDraw = false;
          logPlayback('visualizer.first-draw', {
            ...scene,
            contextGeneration,
            width: surface.width,
            height: surface.height,
            elapsedMs: Math.round(performance.now() - drawStartedAt),
            reducedMotion
          });
        }
      } catch (error) {
        reportFailure(error);
        throw error;
      }
    };
    const resize = () => {
      stage = 'resize';
      try {
        runtime.resize(surface.clientWidth, surface.clientHeight);
      } catch (error) {
        reportFailure(error);
        throw error;
      }
      draw();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (lost) return;
      lost = true;
      contextLostAt = performance.now();
      logPlayback('visualizer.fallback', {
        ...failureFields(),
        reason: 'context-lost'
      });
      setFallback(true);
    };
    const onContextRestored = () => {
      lost = false;
      prepared = false;
      contextGeneration++;
      firstDraw = true;
      drawStartedAt = performance.now();
      failedStages.clear();
      logPlayback('visualizer.context-restored', {
        ...scene,
        contextGeneration,
        outageMs:
          contextLostAt === undefined ? undefined : Math.round(drawStartedAt - contextLostAt)
      });
      contextLostAt = undefined;
      setFallback(false);
      prepareScene();
    };
    const prepareScene = () => {
      stage = 'shaders';
      void runtime
        .prepare()
        .then(() => {
          if (disposed || lost) return;
          prepared = true;
          logPlayback('visualizer.shaders-ready', { ...scene, contextGeneration });
          draw();
        })
        .catch((error) => {
          if (disposed) return;
          reportFailure(error);
          setFallback(true);
        });
    };
    surface.addEventListener('webglcontextlost', onContextLost);
    surface.addEventListener('webglcontextrestored', onContextRestored);
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    const unsubscribe = currentTime.on('change', draw);
    redraw.current = draw;
    setFallback(false);
    resize();
    prepareScene();

    return () => {
      disposed = true;
      redraw.current = null;
      unsubscribe();
      observer.disconnect();
      surface.removeEventListener('webglcontextlost', onContextLost);
      surface.removeEventListener('webglcontextrestored', onContextRestored);
      runtime.destroy();
    };
  }, [currentTime]);

  return (
    <div className="minion-room" data-minion-renderer={fallback ? 'fallback' : 'webgl'}>
      <div className="minion-room-surround" style={{ backgroundImage: `url(${roomUrl})` }} />
      <div className="minion-room-stage">
        <img className="minion-room-backdrop" src={roomUrl} alt="" draggable={false} />
        <canvas ref={canvas} className="minion-room-canvas" aria-hidden="true" />
        {active && (
          <span
            className={fallback ? 'minion-fallback-sign' : 'sr-only'}
            data-minion-lyric=""
            data-minion-holder={active.holder}
          >
            {active.text}
          </span>
        )}
      </div>
    </div>
  );
}
