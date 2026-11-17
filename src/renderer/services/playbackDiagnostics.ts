import { logPlayback } from '@/utils/playbackLog';

import type { PlaybackLogData } from '../../shared/playbackLog';

// Passive, bounded observers. No frame loop and no media capture or playback commands.
export function startPlaybackDiagnostics(readPlayback: () => PlaybackLogData): () => void {
  const snapshot = (): PlaybackLogData => {
    try {
      return readPlayback();
    } catch {
      return {};
    }
  };
  let expectedAt = performance.now() + 1000;
  let lastDelayLogAt = -Infinity;
  let suppressedDelays = 0;
  let largestDelayMs = 0;
  let taskCount = 0;
  let taskTotalMs = 0;
  let taskMaxMs = 0;
  let taskFirstAt = 0;
  let lastTaskLogAt = -Infinity;
  const observer =
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
      ? new PerformanceObserver((list) => {
          if (!snapshot().actualPlaying) return;
          for (const entry of list.getEntries()) {
            if (entry.duration < 100) continue;
            taskCount++;
            taskTotalMs += entry.duration;
            taskMaxMs = Math.max(taskMaxMs, entry.duration);
            if (!taskFirstAt) taskFirstAt = entry.startTime;
          }
        })
      : undefined;
  try {
    observer?.observe({ type: 'longtask', buffered: false });
  } catch {
    /* Optional browser capability. */
  }
  logPlayback('diagnostics.renderer-start', {
    diagnosticsVersion: 3,
    longTaskSupported: Boolean(observer)
  });

  const timer = window.setInterval(() => {
    try {
      const now = performance.now();
      const delayMs = Math.max(0, now - expectedAt);
      expectedAt = now + 1000;
      const playback = snapshot();
      if (playback.actualPlaying && delayMs > (document.hidden ? 1500 : 200)) {
        largestDelayMs = Math.max(largestDelayMs, delayMs);
        if (now - lastDelayLogAt >= 5000) {
          logPlayback('renderer.scheduler-delay', {
            ...playback,
            delayMs: Math.round(delayMs),
            largestDelayMs: Math.round(largestDelayMs),
            suppressedDelays,
            backgroundThrottlePossible: document.hidden
          });
          lastDelayLogAt = now;
          largestDelayMs = suppressedDelays = 0;
        } else suppressedDelays++;
      }
      if (taskCount && now - lastTaskLogAt >= 5000) {
        logPlayback('renderer.long-task', {
          ...playback,
          taskCount,
          totalTaskMs: Math.round(taskTotalMs),
          longestTaskMs: Math.round(taskMaxMs),
          firstTaskTimeMs: Math.round(taskFirstAt),
          firstTaskEpochMs: Math.round(performance.timeOrigin + taskFirstAt)
        });
        taskCount = taskTotalMs = taskMaxMs = taskFirstAt = 0;
        lastTaskLogAt = now;
      }
    } catch {
      /* Diagnostic failures never change playback. */
    }
  }, 1000);

  const visibility = () => {
    expectedAt = performance.now() + 1000;
    logPlayback('app.page-visibility', snapshot());
  };
  const focus = () => logPlayback('app.page-focus', snapshot());
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('focus', focus);
  window.addEventListener('blur', focus);
  return () => {
    window.clearInterval(timer);
    observer?.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('focus', focus);
    window.removeEventListener('blur', focus);
  };
}
