import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createMusicFallbackClient } from '../src/renderer/services/musicFallback.ts';

const state = {
  settings: { enableMusicUnblock: true, enabledMusicSources: ['kuwo'] },
  database: new Map(),
  events: [],
  calls: 0,
  result: null,
  databaseUnavailable: false
};
globalThis.__sourceRecoveryTest = state;
globalThis.window = {
  api: {
    unblockMusic: async () => {
      state.calls++;
      return state.result;
    }
  }
};
const stub = (body) => `data:text/javascript,${encodeURIComponent(body)}`;
const stubs = {
  lodash: stub('export const cloneDeep=value=>structuredClone(value);'),
  '@/hooks/MusicHook': stub(`const s=globalThis.__sourceRecoveryTest;export const musicDB={
    getData:async(table,id)=>s.database.get(table+':'+id),
    saveData:async(table,value)=>s.database.set(table+':'+value.id,value),
    deleteData:async(table,id)=>{if(s.databaseUnavailable)throw new Error('offline');s.database.delete(table+':'+id)}
  };`),
  '@/services/SongSourceConfigManager': stub(
    'export const SongSourceConfigManager={getConfig:()=>null};'
  ),
  '@/store': stub(
    'export const useSettingsStore=()=>({setData:globalThis.__sourceRecoveryTest.settings});'
  ),
  '@/utils': stub('export const isElectron=true;'),
  '@/utils/playbackLog':
    stub(`export const logPlayback=(event,data)=>globalThis.__sourceRecoveryTest.events.push({event,data});
    export const playbackErrorFields=()=>({});`),
  '@/utils/request_music': stub(
    'export default {configured:false,getMusic:()=>{throw new Error("Unconfigured endpoint requested")}};'
  )
};
registerHooks({
  load(url, context, next) {
    if (url.endsWith('/services/playbackRequestManager.ts')) {
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {
          mode: 'transform'
        }),
        shortCircuit: true
      };
    }
    return next(url, context);
  },
  resolve(specifier, context, next) {
    if (stubs[specifier]) return { url: stubs[specifier], shortCircuit: true };
    if (context.parentURL?.endsWith('/api/musicParser.ts')) {
      if (specifier === './gdmusic')
        return { url: stub('export const parseFromGDMusic=async()=>null;'), shortCircuit: true };
      if (specifier === './parseFromCustomApi')
        return { url: stub('export const parseFromCustomApi=async()=>null;'), shortCircuit: true };
      if (specifier === './lxMusicStrategy')
        return {
          url: stub(
            'export class LxMusicStrategy {name="lxMusic";priority=0;canHandle(){return false}}'
          ),
          shortCircuit: true
        };
    }
    if (specifier.startsWith('@/'))
      return next(
        new URL('../src/renderer/' + specifier.slice(2) + '.ts', import.meta.url).href,
        context
      );
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
    return next(specifier, context);
  }
});
const { CacheManager, MusicParser } = await import('../src/renderer/api/musicParser.ts');
const { playbackRequestManager } =
  await import('../src/renderer/services/playbackRequestManager.ts');
const song = (id) => ({ id, name: 'Source recovery fixture', source: 'netease' });

test('missing and placeholder fallback endpoints issue no request', async () => {
  for (const endpoint of [
    undefined,
    null,
    '',
    'undefined',
    'null',
    '***',
    '/api',
    'file:///tmp/api',
    'https://example.test?query=x'
  ]) {
    const client = createMusicFallbackClient(endpoint);
    assert.equal(client.configured, false, String(endpoint));
    assert.equal(await client.getMusic(1), null);
  }
  state.settings.enabledMusicSources = [];
  const result = await MusicParser.parseMusic(700001, song(700001), 'playback_1_1');
  assert.equal(result.data.code, 404);
  assert.ok(
    state.events.some(
      (e) =>
        e.event === 'source.parser-fallback' &&
        e.data.reason === 'unconfigured' &&
        e.data.outcome === 'skipped'
    )
  );
});

test('configured fallback keeps its API path and forwards HTTP failure', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const failure = req.url.includes('id=2');
    res.writeHead(failure ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ code: failure ? 503 : 200, data: { url: 'https://example.test/song.mp3' } })
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = createMusicFallbackClient(`http://127.0.0.1:${server.address().port}/api/`);
    assert.equal(client.configured, true);
    assert.equal((await client.getMusic(1)).data.code, 200);
    await assert.rejects(client.getMusic(2), (error) => error.response.status === 503);
    assert.deepEqual(requests, ['/api/music?id=1', '/api/music?id=2']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('foreground playback retries a negative-cached source while background/recovery remain bounded', async () => {
  const id = 700002;
  state.settings.enabledMusicSources = ['kuwo'];
  state.result = null;
  const before = state.calls;
  await MusicParser.parseMusic(id, song(id));
  assert.equal(state.calls, before + 1);
  await MusicParser.parseMusic(id, song(id));
  const recovery = playbackRequestManager.createRequest(song(id));
  await MusicParser.parseMusic(id, song(id), recovery);
  assert.equal(state.calls, before + 1, 'background and automatic recovery keep cooldown');
  state.result = { url: 'https://example.test/recovered.mp3' };
  const foreground = playbackRequestManager.createRequest(song(id), true);
  const result = await MusicParser.parseMusic(id, song(id), foreground);
  assert.equal(result.data.data.url, state.result.url);
  assert.equal(state.calls, before + 2, 'explicit playback calls the source again immediately');
});

test('clearing a song clears all current failure entries even when IndexedDB fails', async () => {
  const id = 700003;
  for (const strategy of ['lxMusic', 'custom', 'unblockMusic'])
    CacheManager.addFailedCache(id, strategy);
  CacheManager.addFailedCache(id + 1, 'unblockMusic');
  state.databaseUnavailable = true;
  try {
    await CacheManager.clearMusicCache(id);
  } finally {
    state.databaseUnavailable = false;
  }
  for (const strategy of ['lxMusic', 'custom', 'unblockMusic'])
    assert.equal(CacheManager.isInFailedCache(id, strategy), false);
  assert.equal(
    CacheManager.isInFailedCache(id + 1, 'unblockMusic'),
    true,
    'other songs retain their cooldown'
  );
});

test('superseded parsing cannot bypass the cache or launch a source attempt', async () => {
  const id = 700005;
  const old = playbackRequestManager.createRequest(song(id), true);
  playbackRequestManager.createRequest(song(id + 1), true);
  CacheManager.addFailedCache(id, 'unblockMusic');
  const before = state.calls;
  await assert.rejects(MusicParser.parseMusic(id, song(id), old), /Request cancelled/);
  assert.equal(state.calls, before);
  assert.equal(CacheManager.isInFailedCache(id, 'unblockMusic'), true);
});
