import './index.css';
import '@/assets/css/mobile.css';
import 'animate.css';
import 'remixicon/fonts/remixicon.css';
// 自定义外观：主界面壁纸、界面透明度、夜间模式亮度
import './alger-custom/theme.css';
import './alger-custom/theme.js';

import { createApp } from 'vue';

import i18n from '@/../i18n/renderer';
import router from '@/router';
import pinia from '@/store';
import { logPlayback, playbackErrorFields } from '@/utils/playbackLog';

import App from './App.vue';
import directives from './directive';

// Keep an error loop from crowding out audio and recovery events.
const RENDERER_ERROR_WINDOW_MS = 60_000;
const MAX_RENDERER_ERRORS = 8;
const assetBase = new URL('./assets/', window.location.href).href;
let errorWindowStart = 0;
let rendererErrorCount = 0;

interface RendererErrorLocation {
  bundle?: string;
  line?: number;
  column?: number;
}

const getErrorLocation = (error: unknown, event?: ErrorEvent): RendererErrorLocation => {
  if (event) {
    const asset = event.filename.startsWith(assetBase)
      ? event.filename.slice(assetBase.length)
      : '';
    return {
      bundle: /^[\w-]{1,100}\.js$/.test(asset) ? asset : undefined,
      line: event.lineno || undefined,
      column: event.colno || undefined
    };
  }

  // Persist only the first packaged bundle frame, without the stack or its file paths.
  if (error instanceof Error && typeof error.stack === 'string') {
    for (const frame of error.stack.slice(0, 4096).split('\n').slice(1, 12)) {
      const start = frame.indexOf(assetBase);
      if (start < 0 || !/^\s+at\s/.test(frame)) continue;
      const match = /^([\w-]{1,100}\.js):(\d{1,9}):(\d{1,9})(?:\)|$)/.exec(
        frame.slice(start + assetBase.length)
      );
      if (match) return { bundle: match[1], line: Number(match[2]), column: Number(match[3]) };
    }
  }
  return {};
};

const reportRendererError = (
  event: 'renderer.uncaught-error' | 'renderer.unhandled-rejection' | 'renderer.vue-error',
  error: unknown,
  location?: ErrorEvent,
  vueErrorCode?: number
) => {
  const now = performance.now();
  if (now - errorWindowStart >= RENDERER_ERROR_WINDOW_MS) {
    errorWindowStart = now;
    rendererErrorCount = 0;
  }
  if (rendererErrorCount >= MAX_RENDERER_ERRORS) return;
  rendererErrorCount++;

  try {
    logPlayback(event, {
      ...playbackErrorFields(error),
      ...getErrorLocation(error, location),
      vueErrorCode
    });
  } catch {
    // A rejection may be an arbitrary object with throwing property getters.
    logPlayback(event, { errorType: 'uninspectable' });
  }
};

window.addEventListener('error', (event) => {
  if (event instanceof ErrorEvent)
    reportRendererError('renderer.uncaught-error', event.error, event);
});
window.addEventListener('unhandledrejection', (event) => {
  reportRendererError('renderer.unhandled-rejection', event.reason);
});

const app = createApp(App);

if (import.meta.env.PROD) {
  app.config.errorHandler = (error, _instance, info) => {
    const code = /^https:\/\/vuejs\.org\/error-reference\/#runtime-(\d+)$/.exec(info)?.[1];
    reportRendererError('renderer.vue-error', error, undefined, code ? Number(code) : undefined);
    if (app.config.throwUnhandledErrorInProduction) throw error;
    console.error(error);
  };
}

Object.keys(directives).forEach((key: string) => {
  app.directive(key, directives[key as keyof typeof directives]);
});

app.use(pinia);
app.use(router);
app.use(i18n as any);
app.mount('#app');
