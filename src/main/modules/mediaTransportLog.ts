import { createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { ipcMain, type Session, type WebContents } from 'electron';

import { PLAYBACK_MEDIA_CHANNEL, playbackRequestIdField } from '../../shared/playbackLog';
import { writePlaybackLog } from './playbackLog';

const sessionSalt = randomBytes(32);
const LIMIT = 256;

const describeSource = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 8192) return undefined;
  try {
    const url = new URL(value);
    const scheme = url.protocol.slice(0, -1);
    if (!['http', 'https', 'local', 'file', 'blob'].includes(scheme)) return undefined;
    url.hash = '';
    const mediaKey = createHmac('sha256', sessionSalt).update(url.href).digest('hex').slice(0, 20);
    return { mediaKey, scheme };
  } catch {
    return undefined;
  }
};

export const mediaSourceKey = (value: unknown): string | undefined =>
  describeSource(value)?.mediaKey;

const readHeader = (headers: Record<string, string | string[]> | undefined, name: string) => {
  const key = headers && Object.keys(headers).find((header) => header.toLowerCase() === name);
  const value = key ? headers?.[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
};

const safeContentType = (value: string | undefined) => {
  if (!value) return undefined;
  const type = value.split(';', 1)[0].trim().toLowerCase();
  if (
    [
      'audio/mpeg',
      'audio/mp3',
      'audio/mp4',
      'audio/aac',
      'audio/flac',
      'audio/x-flac',
      'audio/wav',
      'audio/x-wav',
      'audio/ogg',
      'audio/opus',
      'audio/webm',
      'application/octet-stream',
      'application/json',
      'text/html',
      'text/plain'
    ].includes(type)
  ) {
    return type;
  }
  return type.startsWith('audio/') ? 'other-audio' : 'other';
};

const byteLength = (value: string | undefined) =>
  value && /^[0-9]{1,15}$/.test(value) ? Number(value) : undefined;

export function initializeMediaTransportLog(
  session: Session,
  getMainContents: () => WebContents | undefined
): void {
  const inFlight = new Map<
    number,
    {
      startedAt: number;
      initialMediaKey: string;
      requestRange?: string;
      httpStatus?: number;
    }
  >();
  const observed = new Set<string>();
  const filter: Electron.WebRequestFilter = { urls: ['<all_urls>'], types: ['media'] };
  const isMainMedia = (details: { webContentsId?: number; resourceType: string }) =>
    details.resourceType === 'media' &&
    details.webContentsId !== undefined &&
    details.webContentsId === getMainContents()?.id;

  ipcMain.on(
    PLAYBACK_MEDIA_CHANNEL,
    (event, id: unknown, attempt: unknown, url: unknown, loaded: unknown) => {
      if (event.sender !== getMainContents() || event.senderFrame !== event.sender.mainFrame)
        return;
      const source = describeSource(url);
      const requestId = playbackRequestIdField(id);
      const audioAttempt =
        typeof attempt === 'number' && Number.isSafeInteger(attempt) && attempt > 0
          ? attempt
          : undefined;
      if (!source || (!audioAttempt && !requestId)) return;
      writePlaybackLog('transport.bind', {
        requestId,
        audioAttempt,
        stage: audioAttempt ? 'audio' : 'preload',
        ...source,
        loadedMediaKey: mediaSourceKey(loaded)
      });
    }
  );

  session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    callback({});
    if (!isMainMedia(details)) return;
    const source = describeSource(details.url);
    if (!source) return;
    if (inFlight.size >= LIMIT) inFlight.delete(inFlight.keys().next().value!);
    const range = readHeader(details.requestHeaders, 'range');
    const state = inFlight.get(details.id) ?? {
      startedAt: performance.now(),
      initialMediaKey: source.mediaKey
    };
    state.requestRange =
      range && /^bytes=(\d{1,15}-\d{0,15}|-\d{1,15})$/.test(range) ? range : undefined;
    inFlight.set(details.id, state);
  });

  const recordResponse = (
    details: Electron.OnHeadersReceivedListenerDetails & { fromCache?: boolean }
  ) => {
    if (!isMainMedia(details)) return;
    const source = describeSource(details.url);
    if (!source) return;
    const state = inFlight.get(details.id);
    if (state) state.httpStatus = details.statusCode;
    const elapsedMs = state ? Math.round(performance.now() - state.startedAt) : undefined;
    const key = `${source.mediaKey}:${details.statusCode}`;
    if (details.statusCode < 400 && (elapsedMs ?? 0) < 1000 && observed.has(key)) return;
    if (observed.size >= LIMIT) observed.delete(observed.values().next().value!);
    observed.add(key);
    const range = readHeader(details.responseHeaders, 'content-range');
    writePlaybackLog('transport.response', {
      ...source,
      transportId: details.id,
      initialMediaKey: state?.initialMediaKey,
      elapsedMs,
      httpStatus: details.statusCode,
      fromCache: details.fromCache,
      requestRange: state?.requestRange,
      contentRange:
        range && /^bytes (\d{1,15}-\d{1,15}|\*)\/(\d{1,15}|\*)$/.test(range) ? range : undefined,
      contentLength: byteLength(readHeader(details.responseHeaders, 'content-length')),
      contentType: safeContentType(readHeader(details.responseHeaders, 'content-type'))
    });
  };

  // An HTTP rejection can end before Chromium starts delivering the media body.
  session.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({});
    if (details.statusCode >= 400) recordResponse(details);
  });
  session.webRequest.onResponseStarted(filter, (details) => {
    if (details.statusCode < 400) recordResponse(details);
  });

  session.webRequest.onCompleted(filter, ({ id }) => inFlight.delete(id));
  session.webRequest.onErrorOccurred(filter, (details) => {
    const state = inFlight.get(details.id);
    inFlight.delete(details.id);
    if (!isMainMedia(details) && !state) return;
    const source = describeSource(details.url);
    if (!source) return;
    writePlaybackLog('transport.error', {
      ...source,
      transportId: details.id,
      initialMediaKey: state?.initialMediaKey,
      elapsedMs: state ? Math.round(performance.now() - state.startedAt) : undefined,
      httpStatus: state?.httpStatus,
      fromCache: details.fromCache,
      requestRange: state?.requestRange,
      netError: /^net::ERR_[A-Z0-9_]{1,64}$/.test(details.error) ? details.error : undefined,
      aborted: details.error === 'net::ERR_ABORTED'
    });
  });
}
