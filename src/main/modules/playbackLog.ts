import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { app, ipcMain, type WebContents } from 'electron';

import { PLAYBACK_LOG_CHANNEL, type PlaybackLogData } from '../../shared/playbackLog';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LINE_BYTES = 4096;
const MAX_PENDING_WRITES = 128;
const sessionId = randomUUID();

let writeQueue = Promise.resolve();
let pendingWrites = 0;
let directoryReady = false;
let writeFailed = false;

export function writePlaybackLog(event: string, data: PlaybackLogData = {}): void {
  if (pendingWrites >= MAX_PENDING_WRITES) return;

  const line = JSON.stringify({ time: new Date().toISOString(), sessionId, event, data }) + '\n';
  const lineBytes = Buffer.byteLength(line);
  if (lineBytes > MAX_LINE_BYTES) return;

  pendingWrites++;
  writeQueue = writeQueue
    .then(async () => {
      const directory = join(app.getPath('userData'), 'logs');
      const path = join(directory, 'playback.log');
      if (!directoryReady) {
        await mkdir(directory, { recursive: true });
        directoryReady = true;
      }

      const size = await stat(path).then(
        (file) => file.size,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return 0;
          throw error;
        }
      );
      if (size + lineBytes > MAX_FILE_BYTES) {
        await rename(path, join(directory, 'playback.previous.log'));
      }
      await appendFile(path, line, 'utf8');
      writeFailed = false;
    })
    .catch(() => {
      directoryReady = false;
      if (!writeFailed) console.warn('无法写入本地播放诊断日志');
      writeFailed = true;
    })
    .finally(() => {
      pendingWrites--;
    });
}

export function initializePlaybackLog(getMainContents: () => WebContents | undefined): void {
  ipcMain.on(PLAYBACK_LOG_CHANNEL, (event, name: unknown, data: unknown) => {
    if (
      event.sender !== getMainContents() ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      return;
    }
    if (typeof name !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(name)) return;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;

    // IPC 参数来自界面，序列化失败也不能影响播放或主进程。
    try {
      writePlaybackLog(name, data as PlaybackLogData);
    } catch {
      // 忽略无法序列化的日志。
    }
  });
}
