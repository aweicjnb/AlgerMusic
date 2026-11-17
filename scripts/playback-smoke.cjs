// Run against an unpacked AlgerMusicPlayer.exe with a temporary profile.
// Local fixtures are the default; --live-source-audit-output uses actual online sources.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const executable = process.argv[2] || process.env.ALGER_TEST_EXE;
if (!executable || !fs.existsSync(executable)) {
  console.error('Usage: node scripts/playback-smoke.cjs <AlgerMusicPlayer.exe>');
  process.exit(2);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alger-playback-smoke-'));
const benchmark = process.argv.includes('--benchmark');
const debugPort = 9236;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sampleRate = 8000;
const durationSeconds = benchmark ? 180 : 20;
const realAudioFile = process.argv
  .find((arg) => arg.startsWith('--real-audio-file='))
  ?.slice('--real-audio-file='.length);
const realAudio = realAudioFile ? fs.readFileSync(realAudioFile) : undefined;
const wav = Buffer.alloc(44 + sampleRate * durationSeconds * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < sampleRate * durationSeconds; i++) {
  wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 900), 44 + i * 2);
}

const rhythmAudio = new Map();
const pulseWav = (bpm) => {
  if (rhythmAudio.has(bpm)) return rhythmAudio.get(bpm);
  const result = Buffer.alloc(44 + sampleRate * 45 * 2);
  wav.copy(result, 0, 0, 44);
  result.writeUInt32LE(result.length - 8, 4);
  result.writeUInt32LE(result.length - 44, 40);
  let noise = 12345;
  for (let i = 0; i < sampleRate * 45; i++) {
    const t = i / sampleRate;
    const phase = t % (60 / bpm);
    noise = (noise * 1664525 + 1013904223) >>> 0;
    const hit =
      0.58 * Math.exp(-phase / 0.035) * Math.sin(2 * Math.PI * 100 * t) +
      0.08 * Math.exp(-phase / 0.015) * (noise / 2 ** 32 - 0.5);
    const bed = 0.015 * Math.sin(2 * Math.PI * 220 * t);
    result.writeInt16LE(Math.round((hit + bed) * 32767), 44 + i * 2);
  }
  rhythmAudio.set(bpm, result);
  return result;
};

let profileFixtures = {};
const lyricFixtures = new Map();
const server = http.createServer((request, response) => {
  const route = new URL(request.url, 'http://localhost').pathname;
  if (route === '/lyric-fixture') {
    const id = new URL(request.url, 'http://localhost').searchParams.get('id');
    const fixture = lyricFixtures.get(Number(id));
    if (!fixture) {
      response.writeHead(404).end();
      return;
    }
    fixture.hits = (fixture.hits || 0) + 1;
    (fixture.requestedAt ||= []).push(Date.now());
    const reply =
      fixture.replies?.[Math.min(fixture.hits - 1, fixture.replies.length - 1)] || fixture;
    setTimeout(() => {
      if (response.destroyed) return;
      response.writeHead(reply.status || 200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': request.headers.origin || 'null',
        'Access-Control-Allow-Credentials': 'true'
      });
      response.end(JSON.stringify(reply.data));
    }, reply.delay);
    return;
  }
  const fixture = profileFixtures[route.replace(/^\/fixture/, '')];
  if (route.startsWith('/fixture/') && fixture) {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': request.headers.origin || 'null',
      'Access-Control-Allow-Credentials': 'true'
    });
    response.end(JSON.stringify(fixture));
    return;
  }
  if (route === '/slow-broken.wav') {
    setTimeout(() => response.writeHead(503).end(), 900);
    return;
  }
  if (route === '/broken.wav' || route === '/forbidden.wav') {
    response.writeHead(route === '/forbidden.wav' ? 403 : 503).end();
    return;
  }
  if (
    !['/song.wav', '/slow.wav', '/real.mp3'].includes(route) ||
    (route === '/real.mp3' && !realAudio)
  ) {
    response.writeHead(404).end();
    return;
  }
  const bpm = Number(new URL(request.url, 'http://localhost').searchParams.get('bpm'));
  const audio = route === '/real.mp3' ? realAudio : bpm >= 55 && bpm <= 200 ? pulseWav(bpm) : wav;
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), audio.length - 1) : audio.length - 1;
  const headers = {
    'Content-Type': route === '/real.mp3' ? 'audio/mpeg' : 'audio/wav',
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*'
  };
  if (match) headers['Content-Range'] = `bytes ${start}-${end}/${audio.length}`;
  const send = () => {
    if (response.destroyed) return;
    response.writeHead(match ? 206 : 200, headers);
    response.end(audio.subarray(start, end + 1));
  };
  if (route === '/slow.wav') setTimeout(send, 900);
  else send();
});

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const audioUrl = `http://127.0.0.1:${server.address().port}/song.wav`;
  let app = spawn(
    executable,
    [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`],
    {
      windowsHide: true,
      stdio: 'ignore'
    }
  );
  let socket;
  try {
    let target;
    for (let i = 0; i < 90; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        target = (await response.json()).find(
          (item) => item.type === 'page' && item.webSocketDebuggerUrl
        );
        if (target) break;
      } catch {
        // The debug endpoint may not be ready during startup.
      }
      await delay(500);
    }
    assert.ok(target, 'Electron debug page is available');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message));
      else task.resolve(message.result);
    };
    socket.addEventListener('message', onMessage);
    const call = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', {
        // Keep async test results reachable during screenshot-heavy runs.
        expression: `globalThis.__algerSmokePending = (0,eval)(${JSON.stringify(expression)})`,
        awaitPromise: true,
        returnByValue: true
      });
      if (result.exceptionDetails)
        throw new Error(result.result?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const waitFor = async (expression, description, timeoutMs = 16000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await delay(200);
      }
      throw new Error(`Timed out: ${description}`);
    };
    const restart = async () => {
      const exited = new Promise((resolve) => app.once('exit', resolve));
      await evaluate(`setTimeout(()=>window.api.quitApp(),50); true`);
      await Promise.race([
        exited,
        delay(5000).then(() => {
          throw new Error('App did not exit normally');
        })
      ]);
      socket.close();
      await delay(500);
      app = spawn(
        executable,
        [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`],
        { windowsHide: true, stdio: 'ignore' }
      );
      let nextTarget;
      for (let i = 0; i < 90; i++) {
        try {
          const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
          nextTarget = (await response.json()).find(
            (item) => item.type === 'page' && item.webSocketDebuggerUrl
          );
          if (nextTarget) break;
        } catch {
          // Wait for the restarted process to expose its debug endpoint.
        }
        await delay(300);
      }
      assert.ok(nextTarget, 'Restarted app debug target');
      socket = new WebSocket(nextTarget.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
      socket.addEventListener('message', onMessage);
      await call('Runtime.enable', {});
      await waitFor(
        `Boolean(document.querySelector('#app')?.__vue_app__?._context)`,
        'app restarted'
      );
    };
    await call('Runtime.enable', {});
    let ready = false;
    for (let i = 0; i < 80; i++) {
      ready = await evaluate(`Boolean(document.querySelector('#app')?.__vue_app__?._context)`);
      if (ready) break;
      await delay(500);
    }
    assert.ok(ready, 'Vue app mounted');
    if (process.argv.includes('--generate-environment')) {
      const project = path.resolve(__dirname, '..');
      const threeUrl = pathToFileURL(
        path.join(project, 'node_modules/three/build/three.module.js')
      ).href;
      const roomUrl = pathToFileURL(
        path.join(project, 'node_modules/three/examples/jsm/environments/RoomEnvironment.js')
      ).href;
      const result = await evaluate(`(async()=>{
        const map=document.createElement('script');map.type='importmap';map.textContent=${JSON.stringify(JSON.stringify({ imports: { three: threeUrl } }))};document.head.appendChild(map);
        const THREE=await import(${JSON.stringify(threeUrl)});const {RoomEnvironment}=await import(${JSON.stringify(roomUrl)});
        const renderer=new THREE.WebGLRenderer();const room=new RoomEnvironment();const generator=new THREE.PMREMGenerator(renderer);
        const target=generator.fromScene(room,0.045,0.1,100,{size:128});const pixels=new Uint16Array(target.width*target.height*4);
        renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
        const data={width:target.width,height:target.height,colorSpace:target.texture.colorSpace,data:Array.from(pixels)};
        target.dispose();generator.dispose();room.dispose();renderer.dispose();return data;
      })()`);
      assert.ok(
        result.data.some((value) => value !== 0),
        'Environment readback has light'
      );
      const output = path.join(project, 'src/renderer/folia/components/visualizer/minions');
      fs.writeFileSync(
        path.join(output, 'room-environment.bin'),
        Buffer.from(Uint16Array.from(result.data).buffer)
      );
      fs.writeFileSync(
        path.join(output, 'room-environment.json'),
        JSON.stringify(
          { width: result.width, height: result.height, colorSpace: result.colorSpace },
          null,
          2
        ) + '\n'
      );
      console.log(
        `Generated environment ${result.width}x${result.height}, ${result.data.length * 2} bytes`
      );
      return;
    }
    const core = `Reflect.ownKeys(document.querySelector('#app').__vue_app__._context.provides).map(k=>document.querySelector('#app').__vue_app__._context.provides[k]).find(v=>v?._s instanceof Map)._s.get('playerCore')`;
    const navigationAuditArg = process.argv.find((arg) =>
      arg.startsWith('--navigation-audit-output=')
    );
    if (navigationAuditArg) {
      const auditDir = navigationAuditArg.slice('--navigation-audit-output='.length);
      fs.mkdirSync(auditDir, { recursive: true });
      const playlist = core.replace("get('playerCore')", "get('playlist')");
      const readEvents = () =>
        fs
          .readFileSync(path.join(profile, 'logs', 'playback.log'), 'utf8')
          .trim()
          .split('\n')
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
      const song = (id, url) => ({
        id,
        name: `Navigation ${id}`,
        source: 'netease',
        playMusicUrl: url,
        backgroundColor: '#222222',
        primaryColor: '#eeeeee',
        ar: [],
        al: { name: '' },
        lyric: { loadState: 'ready', lrcTimeArray: [], lrcArray: [] }
      });
      const a = song(999101, audioUrl),
        bad = song(999102, audioUrl.replace('/song.wav', '/broken.wav')),
        c = song(999103, audioUrl + '?latest=1');
      await evaluate(
        `(()=>{const p=${playlist};p.$patch({playList:${JSON.stringify([a, bad, c])},playListIndex:0,playMode:0})})()`
      );
      await evaluate(`(${core}).handlePlayMusic(${JSON.stringify(a)},true)`);
      await evaluate(`void (${playlist}).nextPlay(new MouseEvent('click'));true`);
      await waitFor(
        `(${core}).playMusic.id===999102&&(${core}).playbackStatus==='failed'`,
        'failed next song'
      );
      await evaluate(`(${playlist}).setPlay(${JSON.stringify(c)})`);
      await waitFor(
        `(${core}).playMusic.id===999103&&(${core}).playbackStatus==='playing'`,
        'new selection after failed next'
      );
      await delay(100);
      const afterSelection = readEvents()
        .filter((e) => e.event === 'playback.request' && e.data.requested?.id === 999103)
        .at(-1)?.seq;
      assert.ok(Number.isFinite(afterSelection), 'New selection is recorded');
      await delay(2300);
      assert.equal(
        await evaluate(`(${core}).playMusic.id===999103&&(${core}).playbackStatus==='playing'`),
        true
      );
      assert.equal(
        readEvents().some((e) => e.seq > afterSelection && e.event === 'playback.request'),
        false,
        'Old next-song timer cannot take over selection'
      );
      // An in-flight previous-song failure must also stop once a new request starts.
      const slowBad = song(999104, audioUrl.replace('/song.wav', '/slow-broken.wav'));
      await evaluate(
        `(()=>{const p=${playlist};p.$patch({playList:${JSON.stringify([slowBad, a, c])},playListIndex:1});void p.prevPlay()})()`
      );
      await delay(30);
      await evaluate(`(${core}).handlePlayMusic(${JSON.stringify(c)},true)`);
      await delay(1400);
      assert.equal(
        await evaluate(
          `(${core}).playMusic.id===999103&&(${core}).playbackStatus==='playing'&&(${playlist}).playList.length===3`
        ),
        true
      );
      // Pass an actual UI event: it must never be used as a retry count.
      await evaluate(
        `(()=>{const p=${playlist};p.$patch({playList:${JSON.stringify([a, bad])},playListIndex:0,playMode:0});void p.nextPlay(new MouseEvent('click'))})()`
      );
      await delay(4500);
      const logs = readEvents();
      const lastRequest = logs
        .filter((e) => e.event === 'playback.request' && e.data.requested?.id === 999102)
        .at(-1);
      assert.equal(lastRequest.data.trigger, 'playlist-retry');
      assert.equal(lastRequest.data.retrySourceFailures, false);
      // The current navigation may continue after removing its own failed entry.
      await evaluate(
        `(()=>{const p=${playlist};p.$patch({playList:${JSON.stringify([bad, a])},playListIndex:1,playMode:0});void p.prevPlay()})()`
      );
      await waitFor(
        `(${core}).playMusic.id===999101&&(${core}).playbackStatus==='playing'&&(${playlist}).playList.length===1`,
        'previous navigation continues past an unavailable song'
      );
      fs.writeFileSync(
        path.join(auditDir, 'navigation-events.json'),
        JSON.stringify(readEvents(), null, 2)
      );
      console.log(
        'PASS stale next/previous retries cannot replace a new selection; UI events and automatic retry cooldown remain bounded'
      );
      return;
    }
    const liveAuditArg = process.argv.find((arg) => arg.startsWith('--live-source-audit-output='));
    if (liveAuditArg) {
      const auditDir = liveAuditArg.slice('--live-source-audit-output='.length);
      fs.mkdirSync(auditDir, { recursive: true });
      const fixtureFile = process.argv
        .find((arg) => arg.startsWith('--live-tracks-file='))
        ?.slice('--live-tracks-file='.length);
      assert.ok(fixtureFile, 'Live track metadata file is required');
      const tracks = JSON.parse(fs.readFileSync(fixtureFile, 'utf8')).filter((s) =>
        [559227860, 1330348068, 1297086004].includes(s.id)
      );
      const settings = core.replace("get('playerCore')", "get('settings')");
      await evaluate(
        `(${settings}).setSetData({enabledMusicSources:['kugou','migu','pyncmd'],enableMusicUnblock:true,musicQuality:'higher'})`
      );
      await evaluate(
        `(()=>{const orig=AudioContext.prototype.createMediaElementSource;AudioContext.prototype.createMediaElementSource=function(media){globalThis.__liveMedia=media;return orig.call(this,media)};window.api.miniTray()})()`
      );
      const results = [];
      for (const track of tracks) {
        const loaded = await evaluate(`(${core}).handlePlayMusic(${JSON.stringify(track)},true)`);
        if (loaded)
          await waitFor(
            `(${core}).playbackStatus==='playing'&&__liveMedia&&!__liveMedia.paused`,
            'real track playback'
          );
        const before = await evaluate(
          `({id:(${core}).playMusic.id,time:globalThis.__liveMedia?.currentTime||0,phase:(${core}).playbackStatus})`
        );
        await delay(5000);
        const after = await evaluate(
          `({id:(${core}).playMusic.id,time:globalThis.__liveMedia?.currentTime||0,phase:(${core}).playbackStatus})`
        );
        const result = { id: track.id, name: track.name, loaded, before, after };
        results.push(result);
        console.log('LIVE_TRACK', JSON.stringify(result));
      }
      const events = fs
        .readFileSync(path.join(profile, 'logs', 'playback.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      fs.writeFileSync(
        path.join(auditDir, 'live-events.json'),
        JSON.stringify({ results, events }, null, 2)
      );
      assert.ok(
        results.filter(
          (r) =>
            r.loaded &&
            r.after.phase === 'playing' &&
            r.after.id === r.id &&
            r.after.time - r.before.time > 4
        ).length >= 2,
        'At least two real network songs actually advance'
      );
      assert.equal(
        events.some(
          (e) =>
            e.event === 'source.attempt' && e.data.route === 'official' && e.data.appCode === -460
        ),
        false
      );
      console.log(
        'PASS live official and configured-source playback without mocked URLs or API responses'
      );
      return;
    }
    const sourceAuditArg = process.argv.find((arg) => arg.startsWith('--source-audit-output='));
    if (sourceAuditArg) {
      const auditDir = sourceAuditArg.slice('--source-audit-output='.length);
      fs.mkdirSync(auditDir, { recursive: true });
      const playlist = core.replace("get('playerCore')", "get('playlist')");
      const settings = core.replace("get('playerCore')", "get('settings')");
      const assetDir = path.join(path.dirname(executable), 'resources/app/out/renderer/assets');
      const sourceModule = fs
        .readdirSync(assetDir)
        .find(
          (name) =>
            name.endsWith('.js') &&
            fs.readFileSync(path.join(assetDir, name), 'utf8').includes('CacheManager as')
        );
      assert.ok(sourceModule, 'Built source module');
      profileFixtures['/source-url'] = { code: 200, data: [{ code: 404, url: null }] };
      const readEvents = () =>
        fs
          .readFileSync(path.join(profile, 'logs', 'playback.log'), 'utf8')
          .trim()
          .split('\n')
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
      const song = (id, url) => ({
        id,
        name: `Source fixture ${id}`,
        source: 'netease',
        playMusicUrl: url,
        backgroundColor: '#222222',
        primaryColor: '#eeeeee',
        ar: [],
        al: { name: '' },
        lyric: {
          loadState: 'ready',
          lrcTimeArray: [0],
          lrcArray: [{ text: 'Test', startTime: 0, duration: 20000 }]
        }
      });
      await evaluate(`(async()=>{
        const mod=await import(${JSON.stringify(pathToFileURL(path.join(assetDir, sourceModule)).href)});
        const values=Object.values(mod);
        globalThis.__sourceCache=values.find(v=>typeof v?.addFailedCache==='function');
        globalThis.__parseSource=values.find(v=>typeof v==='function'&&v.name==='getParsingMusicUrl');
        const setRunner=values.find(v=>typeof v==='function'&&v.name==='setLxMusicRunner');
        if(!__sourceCache||!__parseSource||!setRunner)throw new Error('Source test exports unavailable');
        globalThis.__sourceReady=false;globalThis.__sourceCalls=0;globalThis.__invalidRequests=0;
        setRunner({isInitialized:()=>true,getSources:()=>({wy:{}}),getMusicUrl:async()=>{__sourceCalls++;return __sourceReady?${JSON.stringify(audioUrl)}:null}});
        (${settings}).setSetData({enableMusicUnblock:true,enabledMusicSources:['lxMusic'],activeLxMusicApiId:'test-fixture',lxMusicScripts:[{id:'test-fixture',name:'Local test',script:'fixture'}]});
        const open=XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open=function(method,url,...rest){
          const u=new URL(url,location.href);
          if(u.pathname.includes('/undefined/'))__invalidRequests++;
          if(u.pathname==='/song/url/v1')url=${JSON.stringify(`http://127.0.0.1:${server.address().port}/fixture/source-url`)};
          return open.call(this,method,url,...rest);
        };
      })()`);
      const missing = song(997001);
      const background = await evaluate(`(async()=>{
        await __parseSource(997001,${JSON.stringify(missing)});
        await __parseSource(997001,${JSON.stringify(missing)});
        return {calls:__sourceCalls,cached:__sourceCache.isInFailedCache(997001,'lxMusic')};
      })()`);
      assert.deepEqual(background, { calls: 1, cached: true });
      const unavailable = await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(missing)},true)`
      );
      assert.equal(unavailable, false);
      assert.equal(
        await evaluate('__sourceCalls'),
        2,
        'A playback request really retries the source'
      );
      await evaluate('globalThis.__sourceReady=true');
      assert.equal(
        await evaluate(`(${core}).handlePlayMusic(${JSON.stringify(missing)},true)`),
        true
      );
      await waitFor(`(${core}).playbackStatus==='playing'`, 'retry after source recovery');
      assert.equal(
        await evaluate('__sourceCalls'),
        3,
        'Next manual retry is not blocked for a minute'
      );
      for (let i = 0; i < 60; i++) {
        if (readEvents().some((e) => e.event === 'audio.play' && e.data.requested?.id === 997001))
          break;
        await delay(50);
      }
      const playRequestId = await evaluate(`(${core}).$state.playbackSession?.requestId || null`);
      const before = readEvents().filter((e) => e.event === 'audio.play').length;
      assert.equal(before, 1, 'Current song actually started before testing background preload');
      const broken = song(997002, audioUrl.replace('/song.wav', '/forbidden.wav'));
      await evaluate(
        `(async()=>{(${playlist}).$patch({playList:[${JSON.stringify(broken)}]});await (${playlist}).fetchSongs(0,1)})()`
      );
      await delay(200);
      let logs = readEvents();
      assert.ok(logs.some((e) => e.event === 'preload.failed' && e.data.track?.id === 997002));
      assert.equal(
        logs.some((e) => e.event === 'renderer.unhandled-rejection'),
        false
      );
      assert.equal(
        await evaluate(`(${core}).playMusic.id===997001&&(${core}).playbackStatus==='playing'`),
        true
      );
      assert.equal(
        readEvents().filter((e) => e.event === 'audio.play').length,
        before,
        'Failed next-song preload does not restart current audio'
      );
      const next = song(997002, audioUrl + '?fixed=1');
      await evaluate(
        `(async()=>{(${playlist}).$patch({playList:[${JSON.stringify(next)}]});await (${playlist}).fetchSongs(0,1)})()`
      );
      await delay(150);
      logs = readEvents();
      assert.ok(logs.some((e) => e.event === 'preload.ready' && e.data.track?.id === 997002));
      assert.ok(
        logs.some(
          (e) =>
            e.event === 'source.parser-fallback' &&
            e.data.reason === 'unconfigured' &&
            e.data.outcome === 'skipped'
        )
      );
      assert.equal(await evaluate('__invalidRequests'), 0);
      await evaluate(
        `__sourceCache.addFailedCache(997003,'lxMusic');__sourceCache.addFailedCache(997003,'unblockMusic');`
      );
      assert.equal(
        await evaluate(
          `(async()=>{await __sourceCache.clearMusicCache(997003);return __sourceCache.isInFailedCache(997003,'lxMusic')||__sourceCache.isInFailedCache(997003,'unblockMusic')})()`
        ),
        false
      );
      fs.writeFileSync(
        path.join(auditDir, 'source-events.json'),
        JSON.stringify({ playRequestId, background, events: logs }, null, 2)
      );
      console.log(
        'PASS unconfigured fallback, real source retry through playback, background cooldown, 403 preload isolation, recovered preload and cache clearing'
      );
      return;
    }
    const backgroundAuditArg = process.argv.find((arg) =>
      arg.startsWith('--background-audit-output=')
    );
    if (backgroundAuditArg) {
      const auditDir = backgroundAuditArg.slice('--background-audit-output='.length);
      fs.mkdirSync(auditDir, { recursive: true });
      const measurements = [];
      const phaseMs = Number(
        process.argv
          .find((arg) => arg.startsWith('--background-phase-ms='))
          ?.slice('--background-phase-ms='.length) || 8000
      );
      const seek = Number(
        process.argv
          .find((arg) => arg.startsWith('--background-seek='))
          ?.slice('--background-seek='.length) || 0
      );
      const modes = (
        process.argv
          .find((arg) => arg.startsWith('--background-modes='))
          ?.slice('--background-modes='.length) || 'foreground,minimized,tray'
      ).split(',');
      assert.ok(
        modes.length && modes.every((mode) => ['foreground', 'minimized', 'tray'].includes(mode))
      );
      const sourceFilter = process.argv
        .find((arg) => arg.startsWith('--background-sources='))
        ?.slice('--background-sources='.length);
      assert.ok(phaseMs >= 1000 && phaseMs <= 60000 && seek >= 0);
      const file = path.join(profile, realAudio ? 'background-test.mp3' : 'background-test.wav');
      fs.writeFileSync(file, realAudio || pulseWav(96));
      const localUrl = `local:///${encodeURIComponent(file.replace(/\\/g, '/'))}`;
      const networkUrl = realAudio
        ? audioUrl.replace('/song.wav', '/real.mp3')
        : audioUrl + '?bpm=96';
      for (const [index, url] of [networkUrl, localUrl].entries()) {
        if (sourceFilter && sourceFilter !== (index ? 'local' : 'network')) continue;
        if (index) {
          await evaluate(
            `(()=>{const c=${core};c.$patch({playMusic:{},playMusicUrl:''});c.$persist()})()`
          );
          await restart();
        }
        await evaluate(
          `(()=>{const orig=AudioContext.prototype.createMediaElementSource;AudioContext.prototype.createMediaElementSource=function(media){globalThis.__backgroundMedia=media;return orig.call(this,media)}})()`
        );
        const track = {
          id: 998001 + index,
          name: 'Background playback fixture',
          source: 'netease',
          playMusicUrl: url,
          backgroundColor: '#222222',
          primaryColor: '#eeeeee',
          ar: [],
          al: { name: '' },
          lyric: { loadState: 'ready', lrcTimeArray: [], lrcArray: [] }
        };
        if (seek)
          await evaluate(
            `localStorage.setItem('playProgress',${JSON.stringify(JSON.stringify({ songId: track.id, progress: seek }))})`
          );
        assert.equal(
          await evaluate(`(${core}).handlePlayMusic(${JSON.stringify(track)},true)`),
          true
        );
        await waitFor(
          'Boolean(globalThis.__backgroundMedia)&&!__backgroundMedia.paused',
          'background test media'
        );
        await delay(1000);
        for (const mode of modes) {
          if (mode === 'minimized') await evaluate('window.api.minimize()');
          if (mode === 'tray') await evaluate('window.api.miniTray()');
          await delay(400);
          const snapshot = () =>
            evaluate(
              `({time:performance.now(),position:__backgroundMedia.currentTime,visibility:document.visibilityState,paused:__backgroundMedia.paused,request:(${core}).playMusic.id})`
            );
          const from = await snapshot();
          assert.equal(from.paused, false, 'Test audio remains playing after its initial seek');
          if (seek)
            assert.ok(
              from.position >= seek && from.position < seek + 10,
              `Requested seek ${seek}s, actual ${from.position}s`
            );
          await delay(phaseMs);
          const to = await snapshot();
          const row = {
            source: index ? 'local' : 'network',
            mode,
            from,
            to,
            wallSeconds: (to.time - from.time) / 1000,
            mediaSeconds: to.position - from.position
          };
          row.shortfallSeconds = row.wallSeconds - row.mediaSeconds;
          measurements.push(row);
          fs.writeFileSync(
            path.join(auditDir, 'measurements-progress.json'),
            JSON.stringify(measurements, null, 2)
          );
          console.log('BACKGROUND', JSON.stringify(row));
          assert.equal(to.paused, false);
          assert.equal(to.request, track.id);
          assert.ok(
            row.shortfallSeconds < 1,
            `Playback gap in ${row.source}/${mode}: ${row.shortfallSeconds}s`
          );
        }
      }
      const events = fs
        .readFileSync(path.join(profile, 'logs', 'playback.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      fs.writeFileSync(
        path.join(auditDir, 'background-events.json'),
        JSON.stringify({ measurements, events }, null, 2)
      );
      assert.equal(
        events.filter((e) => e.event === 'playback.request' && e.data.trigger !== 'startup').length,
        sourceFilter ? 1 : 2,
        'Window changes do not restart playback'
      );
      console.log(
        'PASS foreground/minimized/tray playback of network and local audio without restart'
      );
      return;
    }
    const diagnosticsAuditArg = process.argv.find((arg) =>
      arg.startsWith('--diagnostics-audit-output=')
    );
    if (diagnosticsAuditArg) {
      const auditDir = diagnosticsAuditArg.slice('--diagnostics-audit-output='.length);
      fs.mkdirSync(auditDir, { recursive: true });
      const readEvents = () =>
        fs
          .readFileSync(path.join(profile, 'logs', 'playback.log'), 'utf8')
          .trim()
          .split('\n')
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
      const waitForLog = async (predicate, label) => {
        for (let i = 0; i < 60; i++) {
          const match = readEvents().find(predicate);
          if (match) return match;
          await delay(200);
        }
        throw new Error('Timed out waiting for diagnostic log: ' + label);
      };
      await evaluate(
        `(()=>{const original=AudioContext.prototype.createMediaElementSource;AudioContext.prototype.createMediaElementSource=function(media){globalThis.__diagContext=this;globalThis.__diagMedia=media;return original.call(this,media)}})()`
      );
      const track = {
        id: 995001,
        name: 'Passive diagnostics test',
        source: 'netease',
        playMusicUrl: audioUrl,
        backgroundColor: '#222222',
        primaryColor: '#eeeeee',
        ar: [],
        al: { name: '' },
        lyric: {
          loadState: 'ready',
          lrcTimeArray: [0],
          lrcArray: [{ text: 'Diagnostics test', trText: '', startTime: 0, duration: 20000 }]
        }
      };
      await evaluate(`(${core}).handlePlayMusic(${JSON.stringify(track)},true)`);
      await waitFor(
        `Boolean(globalThis.__diagMedia)&&(${core}).playbackStatus==='playing'`,
        'diagnostic media node'
      );
      const clock = await waitForLog(
        (e) => e.event === 'audio.clock-sample',
        'periodic output clock'
      );
      assert.equal(clock.origin, 'renderer');
      assert.ok(Number.isFinite(clock.rendererToMainDelayMs));
      assert.ok(Number.isFinite(clock.data.rendererEpochMs));
      assert.ok(Number.isFinite(clock.data.contextTimeSeconds));
      assert.ok(['visible', 'hidden'].includes(clock.data.pageVisibility));
      assert.ok(
        ['playbackStats', 'playoutStats', 'unavailable'].includes(clock.data.playoutStatsApi)
      );
      const beforePlay = readEvents()
        .filter((e) =>
          [
            'playback.request',
            'audio.loading',
            'audio.play',
            'audio.pause',
            'audio.seek-requested'
          ].includes(e.event)
        )
        .map((e) => e.event);
      // Queue two events across one deliberate renderer block. They are explicitly untrusted test events.
      await evaluate(
        `(()=>{const waiting=new Event('waiting');const until=performance.now()+1400;while(performance.now()<until){}const playing=new Event('playing');__diagMedia.dispatchEvent(waiting);__diagMedia.dispatchEvent(playing)})()`
      );
      const queued = await waitForLog(
        (e) => e.event === 'audio.buffer-resumed' && e.data.trustedEvent === false,
        'queued media events'
      );
      assert.ok(queued.data.eventBufferingMs >= 1300, JSON.stringify(queued.data));
      assert.ok(
        queued.data.bufferingMs < queued.data.eventBufferingMs,
        'Original event interval survives fast callback delivery'
      );
      const waiting = readEvents().find(
        (e) => e.event === 'audio.buffering' && e.data.trustedEvent === false
      );
      assert.ok(waiting.data.eventDispatchDelayMs >= 1300);
      const task = await waitForLog(
        (e) => e.event === 'renderer.long-task' && e.data.longestTaskMs >= 1300,
        'renderer long task'
      );
      assert.ok(task.data.taskCount >= 1);
      await waitForLog(
        (e) => e.event === 'renderer.scheduler-delay' && e.data.delayMs >= 200,
        'renderer timer delay'
      );
      const afterPlay = readEvents()
        .filter((e) =>
          [
            'playback.request',
            'audio.loading',
            'audio.play',
            'audio.pause',
            'audio.seek-requested'
          ].includes(e.event)
        )
        .map((e) => e.event);
      assert.deepEqual(
        afterPlay,
        beforePlay,
        'Observing a stall never restarts, pauses or seeks audio'
      );
      await evaluate(`__diagContext.suspend()`);
      await waitForLog(
        (e) => e.event === 'audio.context-state' && e.data.audioContextState === 'suspended',
        'actual context suspension'
      );
      await waitFor(`__diagContext.state==='running'`, 'existing context recovery');
      await evaluate(`__diagMedia.currentTime=2`);
      await waitForLog((e) => e.event === 'audio.media-seeked', 'native seek boundary');
      await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
      await waitForLog((e) => e.event === 'app.page-visibility', 'visibility diagnostics');
      await evaluate(`(${core}).handlePause()`);
      const clockCount = readEvents().filter((e) =>
        /^audio\.(clock-|output-underrun)/.test(e.event)
      ).length;
      await delay(2200);
      assert.equal(
        readEvents().filter((e) => /^audio\.(clock-|output-underrun)/.test(e.event)).length,
        clockCount,
        'Paused audio does not produce clock-gap logs'
      );
      await evaluate(
        `(${core.replace("get('playerCore')", "get('playlist')")}).setPlay({...(${core}).playMusic})`
      );
      await waitFor(`(${core}).playbackStatus==='playing'`, 'playback after diagnostics');
      const events = readEvents();
      assert.equal(events.filter((e) => e.event === 'playback.request').length, 1);
      assert.equal(
        events.filter((e) => e.droppedBefore).length,
        0,
        'Diagnostic records fit bounded log queue and line size'
      );
      assert.ok(
        events.filter((e) => e.event === 'renderer.long-task').length < 8,
        'Long tasks are aggregated'
      );
      fs.writeFileSync(
        path.join(auditDir, 'diagnostics-events.json'),
        JSON.stringify(events, null, 2)
      );
      console.log(
        'PASS event timestamps/dispatch delay, renderer block/timer diagnostics, real output clock, context state, seek, pause/resume, bounded logs and no automatic replay'
      );
      console.log('OUTPUT_STATS_API', clock.data.playoutStatsApi);
      return;
    }
    const rhythmAuditArg = process.argv.find((arg) => arg.startsWith('--rhythm-audit-output='));
    if (rhythmAuditArg) {
      const auditDir = rhythmAuditArg.slice('--rhythm-audit-output='.length);
      fs.mkdirSync(auditDir, { recursive: true });
      await evaluate(
        `(()=>{globalThis.__rhythmCaptureRequests=0;navigator.mediaDevices.getUserMedia=()=>{globalThis.__rhythmCaptureRequests++;return Promise.reject(new Error('Capture must not be used for rhythm analysis'))}})()`
      );
      await call('Emulation.setDeviceMetricsOverride', {
        width: 1200,
        height: 780,
        deviceScaleFactor: 1,
        mobile: false
      });
      const lyrics = {
        loadState: 'ready',
        lrcTimeArray: Array.from({ length: 23 }, (_, i) => i * 2),
        lrcArray: Array.from({ length: 23 }, (_, i) => ({
          text: `Audio rhythm line ${i}`,
          trText: '',
          startTime: i * 2000,
          duration: 2000
        }))
      };
      const rhythmSong = (id, bpm) =>
        JSON.stringify({
          id,
          name: `Rhythm ${bpm || 'tone'}`,
          source: 'netease',
          playMusicUrl: bpm ? audioUrl + '?bpm=' + bpm : audioUrl,
          backgroundColor: '#222222',
          primaryColor: '#eeeeee',
          ar: [],
          al: { name: '' },
          lyric: lyrics
        });
      const drawer = `document.querySelector('#drawer-target')`;
      const menu = async () => {
        if (
          !(await evaluate(
            `Boolean(document.querySelector('.folia-style-menu')?.checkVisibility())`
          ))
        ) {
          await evaluate(`document.querySelector('[title="歌词动画"]').click()`);
          await waitFor(
            `Boolean(document.querySelector('.folia-style-menu')?.checkVisibility())`,
            'animation menu'
          );
        }
      };
      const selectStyle = async (label) => {
        await menu();
        await evaluate(
          `Array.from(document.querySelectorAll('.folia-style-item')).find(e=>e.querySelector('.folia-style-name').textContent===${JSON.stringify(label)}).click()`
        );
      };
      const snapshot = async (name) => {
        await menu();
        await delay(200);
        const shot = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(auditDir, name + '.png'), Buffer.from(shot.data, 'base64'));
        await evaluate(`document.querySelector('[title="歌词动画"]').click()`);
      };
      await evaluate(
        `(async()=>{const c=${core};await c.handlePlayMusic(${rhythmSong(990001, 72)},true);c.setMusicFull(true)})()`
      );
      await waitFor(`Boolean(${drawer})`, 'rhythm lyric view');
      await selectStyle('自动切换');
      await waitFor(
        `${drawer}?.dataset.rhythmStatus==='ready'`,
        '72 BPM from real audio graph',
        23000
      );
      let detected = Number(await evaluate(`${drawer}.dataset.rhythmBpm`));
      assert.ok(Math.abs(detected - 72) <= 4, `Expected 72 BPM, got ${detected}`);
      await waitFor(
        `${drawer}?.dataset.autoRhythmApplied==='true'`,
        'rhythm reaches automatic choice'
      );
      await snapshot('slow-audio');
      await evaluate(`(${core}).handlePause()`);
      await waitFor(`${drawer}?.dataset.rhythmStatus==='paused'`, 'analysis pauses with playback');
      await delay(500);
      assert.equal(await evaluate(`(${core}).playbackStatus`), 'paused');
      await evaluate(
        `(${core.replace("get('playerCore')", "get('playlist')")}).setPlay({...(${core}).playMusic})`
      );
      await waitFor(`${drawer}?.dataset.rhythmStatus==='ready'`, 'analysis resumes');
      await evaluate(`(${core}).handlePlayMusic(${rhythmSong(990002, 150)},true)`);
      assert.notEqual(
        await evaluate(`${drawer}.dataset.rhythmStatus`),
        'ready',
        'Switch clears previous tempo'
      );
      await waitFor(
        `${drawer}?.dataset.rhythmStatus==='ready'`,
        '150 BPM from real audio graph',
        23000
      );
      detected = Number(await evaluate(`${drawer}.dataset.rhythmBpm`));
      assert.ok(Math.abs(detected - 150) <= 4, `Expected 150 BPM, got ${detected}`);
      await waitFor(
        `${drawer}?.dataset.autoRhythmApplied==='true'`,
        'fast rhythm automatic choice'
      );
      await snapshot('fast-audio');
      const logEvents = () =>
        fs
          .readFileSync(path.join(profile, 'logs', 'playback.log'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
      const choices = logEvents().filter(
        (e) => e.event === 'visualizer.auto-choice' && e.data.track.id === 990002
      );
      assert.ok(
        choices.some((e) => e.data.rhythmApplied),
        'Choice log records real rhythm'
      );
      await delay(1500);
      assert.equal(
        logEvents().filter(
          (e) => e.event === 'visualizer.auto-choice' && e.data.track.id === 990002
        ).length,
        choices.length,
        'Stable rhythm does not keep switching animation'
      );
      assert.equal(
        logEvents().filter((e) => e.event === 'playback.request' && e.data.requested?.id === 990002)
          .length,
        1,
        'Analysis does not replay the song'
      );
      await selectStyle('流光');
      await delay(1200);
      assert.equal(
        await evaluate(`${drawer}.dataset.autoStyle`),
        undefined,
        'Manual style stays manual'
      );
      await selectStyle('自动切换');
      await evaluate(`(${core}).handlePlayMusic(${rhythmSong(990003, 0)},true)`);
      await waitFor(
        `${drawer}?.dataset.rhythmStatus==='uncertain'`,
        'steady tone has no invented BPM',
        20000
      );
      assert.equal(await evaluate(`${drawer}.dataset.rhythmBpm`), undefined);
      await snapshot('steady-tone');
      const errors = logEvents().filter((e) => e.event === 'rhythm.failed');
      assert.equal(errors.length, 0, JSON.stringify(errors));
      fs.writeFileSync(
        path.join(auditDir, 'rhythm-events.json'),
        JSON.stringify(
          logEvents().filter(
            (e) => e.event.startsWith('rhythm.') || e.event === 'visualizer.auto-choice'
          ),
          null,
          2
        )
      );
      assert.equal(await evaluate(`(${core}).playbackStatus`), 'playing');
      assert.equal(
        await evaluate(`globalThis.__rhythmCaptureRequests`),
        0,
        'Rhythm analysis never requests microphone capture'
      );
      console.log(
        'PASS actual audio BPM 72/150, automatic selection, no repeated switching/replay, pause/resume, manual style, sustained-tone fallback'
      );
      return;
    }
    const lyricAuditArg = process.argv.find((arg) => arg.startsWith('--lyric-audit-output='));
    if (lyricAuditArg) {
      const auditDir = lyricAuditArg.slice('--lyric-audit-output='.length);
      fs.mkdirSync(auditDir, { recursive: true });
      const lyricFixture = (label) => ({
        code: 200,
        lrc: { lyric: `[00:00.00]Delayed lyrics ${label}\n[00:02.00]Next line ${label}` },
        yrc: {
          lyric: `[0,2000](0,1000,0)Delayed (1000,1000,0)lyrics ${label}\n[2000,2000](2000,2000,0)Next line ${label}`
        }
      });
      lyricFixtures.set(980001, { delay: 500, data: lyricFixture('A') });
      lyricFixtures.set(980002, { delay: 800, data: lyricFixture('stale') });
      lyricFixtures.set(980003, { delay: 40, data: lyricFixture('latest') });
      lyricFixtures.set(980004, { delay: 40, data: { code: 200, lrc: { lyric: '' } } });
      await evaluate(
        `(()=>{localStorage.setItem('folia-stage-style','off');const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){const requested=new URL(url,location.href);if(requested.pathname==='/lyric/new') url=${JSON.stringify(`http://127.0.0.1:${server.address().port}/lyric-fixture`)}+'?'+requested.searchParams;return open.call(this,method,url,...rest)}})()`
      );
      const song = (id, name) => ({
        id,
        name,
        source: 'netease',
        playMusicUrl: audioUrl,
        backgroundColor: '#222222',
        primaryColor: '#eeeeee',
        picUrl: '',
        ar: [],
        al: { name: '' }
      });
      const visibleLines = `Array.from(document.querySelectorAll('#drawer-target .music-lrc-text[id]')).map(e=>e.textContent.trim())`;
      await evaluate(
        `(async()=>{const c=${core};await c.handlePlayMusic(${JSON.stringify(song(980001, 'Delayed lyric test'))},false);c.setMusicFull(true)})()`
      );
      await waitFor(`Boolean(document.querySelector('#drawer-target'))`, 'full lyric view');
      await delay(700);
      const initial = await evaluate(
        `({storedLines:(${core}).playMusic.lyric?.lrcArray.length,renderedLines:(${visibleLines}).length})`
      );
      console.log('LYRIC delayed metadata', JSON.stringify(initial));
      assert.ok(initial.storedLines > 0, 'Delayed lyric response is stored on the song');
      assert.ok(initial.renderedLines > 0, 'Delayed lyric response reaches the lyric view');
      assert.ok((await evaluate(visibleLines)).some((line) => line.includes('lyrics A')));
      let shot = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(auditDir, 'lyric-delayed.png'), Buffer.from(shot.data, 'base64'));
      await evaluate(
        `(${core}).playMusic.lyric={lrcTimeArray:[0],lrcArray:[{text:'Updated lyrics for the same ID',trText:'',startTime:0,duration:2000}]}`
      );
      await waitFor(
        `(${visibleLines}).includes('Updated lyrics for the same ID')`,
        'same ID lyric replacement'
      );
      await evaluate(
        `(async()=>{const c=${core};const slow=c.handlePlayMusic(${JSON.stringify(song(980002, 'Stale lyric test'))},false);await new Promise(r=>setTimeout(r,50));await c.handlePlayMusic(${JSON.stringify(song(980003, 'Latest lyric test'))},false);await slow;})()`
      );
      await waitFor(
        `(${visibleLines}).some(line=>line.includes('lyrics latest'))`,
        'latest song lyrics'
      );
      assert.ok(
        !(await evaluate(visibleLines)).some((line) => line.includes('stale')),
        'Old song lyrics cannot overwrite the latest song'
      );
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980004, 'Empty lyric test'))},false)`
      );
      await waitFor(`(${visibleLines}).length===0`, 'empty lyrics clear previous lines');
      await waitFor(
        `(${core}).playMusic.lyric?.loadState==='empty'`,
        'confirmed empty lyric result'
      );
      assert.equal(
        await evaluate(`document.querySelectorAll('#drawer-target .no-scroll-tip').length`),
        0,
        'Empty lyrics do not show an untimed lyric warning'
      );
      await evaluate(
        `(${core}).playMusic.lyric={lrcTimeArray:[-1],lrcArray:[{text:'Untimed lyric test',trText:'',startTime:-1}]}`
      );
      await waitFor(
        `document.querySelectorAll('#drawer-target .no-scroll-tip').length===1`,
        'untimed lyric warning'
      );
      const waitForState = (state) =>
        waitFor(
          `Array.from(document.querySelectorAll('[data-lyric-status="${state}"]')).some(e=>e.checkVisibility())`,
          `visible lyric state: ${state}`
        );
      const snapshot = async (name) => {
        await delay(200);
        const capture = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(
          path.join(auditDir, `lyric-${name}.png`),
          Buffer.from(capture.data, 'base64')
        );
      };
      const retry = () =>
        evaluate(
          `(()=>{const b=Array.from(document.querySelectorAll('.lyric-retry')).find(e=>e.checkVisibility());b.click();b.click()})()`
        );
      const waitForAutoRetry = (attempt = 1) =>
        waitFor(
          `Array.from(document.querySelectorAll('[data-lyric-status="loading"][data-lyric-retry-attempt="${attempt}"]')).some(e=>e.checkVisibility())`,
          `automatic lyric retry ${attempt}`
        );
      const waitForHits = async (id, hits) => {
        for (let i = 0; i < 100; i++) {
          if (lyricFixtures.get(id).hits >= hits) return;
          await delay(50);
        }
        throw new Error(`Timed out waiting for ${hits} lyric requests for ${id}`);
      };
      const audioEvents = () =>
        fs
          .readFileSync(path.join(profile, 'logs', 'playback.log'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
          .filter((e) =>
            [
              'playback.request',
              'audio.loading',
              'audio.play',
              'audio.pause',
              'audio.seek-requested'
            ].includes(e.event)
          )
          .map((e) => e.event);
      await call('Emulation.setDeviceMetricsOverride', {
        width: 1200,
        height: 780,
        deviceScaleFactor: 1,
        mobile: false
      });
      lyricFixtures.set(980005, { delay: 2400, data: lyricFixture('slow') });
      const slowStartedAt = Date.now();
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980005, 'Loading lyrics'))},true)`
      );
      assert.ok(Date.now() - slowStartedAt < 2000, 'Slow lyrics do not delay audio playback');
      await waitForState('loading');
      assert.equal(await evaluate(`(${core}).playbackStatus`), 'playing');
      await snapshot('loading');
      await waitFor(
        `(${visibleLines}).some(line=>line.includes('lyrics slow'))`,
        'slow lyric completion'
      );

      lyricFixtures.set(980006, {
        replies: [
          { delay: 40, status: 503, data: { code: 503 } },
          { delay: 400, data: lyricFixture('recovered') }
        ]
      });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980006, 'Retry lyrics without restarting'))},true)`
      );
      await waitForAutoRetry();
      assert.equal(lyricFixtures.get(980006).hits, 1, 'Automatic retry waits before requesting');
      assert.equal(
        await evaluate(
          `Array.from(document.querySelectorAll('.lyric-retry')).some(e=>e.checkVisibility())`
        ),
        false,
        'Manual retry is hidden while automatic recovery is active'
      );
      await snapshot('auto-retrying');
      const beforeRetry = audioEvents();
      await waitFor(
        `(${visibleLines}).some(line=>line.includes('lyrics recovered'))`,
        'automatic retry succeeds without a click'
      );
      await delay(150);
      assert.equal(
        lyricFixtures.get(980006).hits,
        2,
        'Transient failure recovers with one automatic retry'
      );
      assert.deepEqual(
        audioEvents(),
        beforeRetry,
        'Lyric retry does not restart, pause or seek audio'
      );
      assert.equal(await evaluate(`(${core}).playbackStatus`), 'playing');
      await snapshot('retry-success');

      lyricFixtures.set(980007, {
        replies: [
          { delay: 30, data: { code: 503, message: 'Fixture service error' } },
          { delay: 30, data: lyricFixture('valid response') }
        ]
      });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980007, 'Failed response'))},false)`
      );
      await waitFor(
        `(${visibleLines}).some(line=>line.includes('valid response'))`,
        '200 error payload retries automatically'
      );
      assert.equal(lyricFixtures.get(980007).hits, 2);

      lyricFixtures.set(980013, {
        replies: [
          ...Array.from({ length: 3 }, () => ({ delay: 30, status: 503, data: { code: 503 } })),
          { delay: 400, data: lyricFixture('manual fallback') }
        ]
      });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980013, 'Bounded retry then manual fallback'))},true)`
      );
      await waitForState('failed');
      assert.equal(
        lyricFixtures.get(980013).hits,
        3,
        'Automatic retries stop after three attempts'
      );
      const requestTimes = lyricFixtures.get(980013).requestedAt;
      assert.ok(requestTimes[1] - requestTimes[0] >= 950, 'First retry waits one second');
      assert.ok(requestTimes[2] - requestTimes[1] >= 2950, 'Second retry waits three seconds');
      await snapshot('failed');
      await delay(3200);
      assert.equal(lyricFixtures.get(980013).hits, 3, 'Exhausted retries do not loop indefinitely');
      const beforeManualRetry = audioEvents();
      await retry();
      await waitForState('loading');
      await waitFor(
        `(${visibleLines}).some(line=>line.includes('manual fallback'))`,
        'manual fallback after automatic retries'
      );
      await delay(150);
      assert.equal(lyricFixtures.get(980013).hits, 4, 'Double click sends one manual retry');
      assert.deepEqual(audioEvents(), beforeManualRetry, 'Manual retry leaves playback unchanged');

      lyricFixtures.set(980015, {
        replies: [
          { delay: 30, data: { code: 408 } },
          { delay: 30, status: 429, data: { code: 429 } },
          { delay: 30, data: lyricFixture('second retry recovered') }
        ]
      });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980015, 'Rate limit and request timeout'))},false)`
      );
      await waitForAutoRetry(2);
      await snapshot('auto-retrying-second');
      await waitFor(
        `(${visibleLines}).some(line=>line.includes('second retry recovered'))`,
        'rate limit and timeout response code recover on second retry'
      );
      assert.equal(lyricFixtures.get(980015).hits, 3);

      lyricFixtures.set(980008, {
        replies: [
          { delay: 30, data: { code: 200, lrc: { lyric: '' } } },
          { delay: 30, data: lyricFixture('refreshed') }
        ]
      });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980008, 'Confirmed empty lyrics'))},false)`
      );
      await waitForState('empty');
      await snapshot('empty');
      await delay(1200);
      assert.equal(lyricFixtures.get(980008).hits, 1, 'Confirmed empty lyrics do not auto retry');
      await retry();
      await waitFor(
        `(${visibleLines}).some(line=>line.includes('lyrics refreshed'))`,
        'refresh bypasses empty lyric cache'
      );
      assert.equal(
        lyricFixtures.get(980008).hits,
        2,
        'Refresh fetches new data instead of reusing the cached empty response'
      );

      lyricFixtures.set(980009, { delay: 30, data: { code: 200, lrc: { lyric: '[00:00.00]' } } });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980009, 'Malformed lyrics'))},false)`
      );
      await waitForState('failed');
      assert.equal(await evaluate(`(${core}).playMusic.lyric.failureReason`), 'parse');
      await delay(1200);
      assert.equal(lyricFixtures.get(980009).hits, 1, 'Parsing failures do not auto retry');

      lyricFixtures.set(980016, { delay: 30, status: 403, data: { code: 403 } });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980016, 'Permanent request failure'))},false)`
      );
      await waitForState('failed');
      await delay(1200);
      assert.equal(lyricFixtures.get(980016).hits, 1, 'Forbidden requests do not auto retry');

      lyricFixtures.set(980014, {
        replies: [
          { delay: 30, status: 503, data: { code: 503 } },
          { delay: 30, data: lyricFixture('cancelled wait') }
        ]
      });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980014, 'Switch while waiting to retry'))},false)`
      );
      await waitForAutoRetry();
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980003, 'Cancel previous retry timer'))},false)`
      );
      await delay(1300);
      assert.equal(lyricFixtures.get(980014).hits, 1, 'Switching cancels a scheduled retry');

      lyricFixtures.set(980010, {
        replies: [
          { delay: 30, status: 503, data: { code: 503 } },
          { delay: 1500, data: lyricFixture('stale retry') }
        ]
      });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980010, 'Switch during retry'))},false)`
      );
      await waitForHits(980010, 2);
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980003, 'Keep latest song lyrics'))},false)`
      );
      await waitFor(
        `(${visibleLines}).some(line=>line.includes('lyrics latest'))`,
        'new song during retry'
      );
      await delay(1700);
      assert.ok(
        !(await evaluate(visibleLines)).some((line) => line.includes('stale retry')),
        'Late retry cannot overwrite the next song'
      );

      lyricFixtures.set(980011, {
        replies: [
          { delay: 12000, data: lyricFixture('timed out') },
          { delay: 50, data: lyricFixture('timeout recovered') }
        ]
      });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980011, 'Lyric timeout'))},false)`
      );
      await waitForState('loading');
      await waitForAutoRetry();
      await snapshot('timeout-retrying');
      await waitFor(
        `(${visibleLines}).some(line=>line.includes('timeout recovered'))`,
        'real HTTP timeout recovers automatically'
      );
      assert.equal(lyricFixtures.get(980011).hits, 2);
      const lyricLog = fs.readFileSync(path.join(profile, 'logs', 'playback.log'), 'utf8');
      assert.ok(lyricLog.includes('lyric.retry-exhausted'), 'Retry exhaustion is logged');
      assert.ok(
        lyricLog
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .some((e) => e.event === 'lyric.request-result' && e.data?.reason === 'timeout'),
        'Timed out attempts are recorded'
      );

      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song('local:no-lyrics', 'Local track without embedded lyrics'))},false)`
      );
      await evaluate(`(${core}).setMusicFull(true)`);
      await waitForState('empty');
      assert.equal(
        await evaluate(
          `Array.from(document.querySelectorAll('.lyric-retry')).filter(e=>e.checkVisibility()).length`
        ),
        0,
        'Local track without an online ID has no unavailable retry action'
      );
      await snapshot('local-empty');
      const liveId = Number(
        process.argv.find((arg) => arg.startsWith('--lyric-live-id='))?.split('=')[1]
      );
      if (liveId) {
        const response = await fetch('http://127.0.0.1:30488/lyric/new?id=' + liveId);
        assert.ok(response.ok, 'Live lyric endpoint responds');
        lyricFixtures.set(liveId, { delay: 300, data: await response.json() });
        await evaluate(
          `(${core}).handlePlayMusic(${JSON.stringify(song(liveId, '修炼爱情'))},false)`
        );
        await waitFor(`(${visibleLines}).length>10`, 'live song lyrics render');
        const live = await evaluate(
          `({id:(${core}).playMusic.id,renderedLines:(${visibleLines}).length,wordByWord:(${core}).playMusic.lyric.hasWordByWord})`
        );
        console.log('LYRIC live song', JSON.stringify(live));
        shot = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(auditDir, 'lyric-live.png'), Buffer.from(shot.data, 'base64'));
      }
      lyricFixtures.set(980012, {
        replies: [
          ...Array.from({ length: 3 }, () => ({ delay: 30, status: 503, data: { code: 503 } })),
          { delay: 300, data: lyricFixture('mobile recovered') }
        ]
      });
      await evaluate(
        `(${core}).handlePlayMusic(${JSON.stringify(song(980012, 'Mobile lyric retry'))},false)`
      );
      await waitForState('failed');
      const mobileSettings = core.replace("get('playerCore')", "get('settings')");
      await call('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true
      });
      await evaluate(`(${mobileSettings}).isMobile=true;(${core}).setMusicFull(true)`);
      await waitForState('failed');
      await snapshot('mobile-failed');
      await retry();
      await waitFor(`(${core}).playMusic.lyric?.loadState==='ready'`, 'mobile retry succeeds');
      await delay(150);
      fs.writeFileSync(
        path.join(auditDir, 'lyric-retry-events.json'),
        JSON.stringify(
          {
            requests: Object.fromEntries(
              [...lyricFixtures].map(([id, fixture]) => [
                id,
                { hits: fixture.hits, requestedAt: fixture.requestedAt }
              ])
            ),
            events: fs
              .readFileSync(path.join(profile, 'logs', 'playback.log'), 'utf8')
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line))
              .filter((e) => e.event.startsWith('lyric.'))
          },
          null,
          2
        )
      );
      console.log(
        'PASS bounded automatic lyric retries, nonblocking audio, manual fallback, refresh, actual timeout recovery, cancellation and mobile retry'
      );
      console.log(
        'PASS delayed lyrics, same ID replacement, rapid switching, empty and untimed lyric states'
      );
      return;
    }
    const profileAuditArg = process.argv.find((arg) => arg.startsWith('--profile-audit-output='));
    if (profileAuditArg) {
      let emptyRestoreSkipped = false;
      for (let i = 0; i < 50; i++) {
        const startupLog = path.join(profile, 'logs', 'playback.log');
        if (
          fs.existsSync(startupLog) &&
          fs.readFileSync(startupLog, 'utf8').includes('startup.restore-skipped')
        ) {
          emptyRestoreSkipped = true;
          break;
        }
        await delay(100);
      }
      assert.ok(emptyRestoreSkipped, 'Fresh profile skips restoring an empty track');
      const auditDir = profileAuditArg.slice('--profile-audit-output='.length);
      fs.mkdirSync(auditDir, { recursive: true });
      const cover = (color, number) =>
        'data:image/svg+xml;base64,' +
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="16" fill="${color}"/><circle cx="60" cy="52" r="28" fill="white" opacity=".2"/><text x="60" y="78" text-anchor="middle" font-size="42" fill="white">${number}</text></svg>`
        ).toString('base64');
      const fixtureUser = {
        userId: 9990001,
        nickname: '音乐旅人',
        avatarUrl: cover('#567f79', '♪'),
        backgroundUrl: ''
      };
      const fixtureDetail = {
        code: 200,
        level: 9,
        profile: {
          ...fixtureUser,
          followeds: 38,
          follows: 16,
          signature: '把喜欢的旋律，留在每一个日常里。'
        }
      };
      const fixtureSongs = [
        '海边的晚风',
        '童言无忌（Live）',
        '一半甜',
        'The Moments We Shared… I Miss Them',
        '呓语',
        'Adagio for Summer Wind',
        '千禧',
        '年轮说'
      ].map((name, index) => ({
        id: 990100 + index,
        name,
        source: 'netease',
        picUrl: cover(['#597e88', '#a66565', '#a18a59', '#72856a'][index % 4], index + 1),
        ar: [{ id: 1, name: ['示例歌手', '清水淳一 / Key Sounds Label'][index % 2] }],
        al: {
          name: '听歌排行',
          picUrl: cover(['#597e88', '#a66565', '#a18a59', '#72856a'][index % 4], index + 1)
        }
      }));
      const fixtureLists = ['给晚风的歌单', '独处时的安静旋律', '单调清悦', '我的年度精选'].map(
        (name, index) => ({
          id: 999200 + index,
          name,
          creator: { userId: fixtureUser.userId },
          coverImgUrl: cover(['#a66565', '#597e88', '#72856a', '#a18a59'][index], index + 1),
          trackCount: 9 + index,
          playCount: 47 + index * 15
        })
      );
      const payloads = {
        '/user/detail': fixtureDetail,
        '/user/record': {
          code: 200,
          allData: fixtureSongs.map((song) => ({ song, playCount: 12, score: 100 }))
        },
        '/user/playlist': { code: 200, playlist: fixtureLists }
      };
      profileFixtures = payloads;
      await evaluate(
        `(()=>{const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){const path=new URL(url,location.href).pathname;if(${JSON.stringify(Object.keys(payloads))}.includes(path)) url=${JSON.stringify(`http://127.0.0.1:${server.address().port}/fixture`)}+path;return open.call(this,method,url,...rest)}})()`
      );
      const userStore = core.replace("get('playerCore')", "get('user')");
      const settingsStore = core.replace("get('playerCore')", "get('settings')");
      await evaluate(
        `(async()=>{const u=${userStore}; u.setUser(${JSON.stringify(fixtureUser)});u.setLoginType('uid');u.userDetail=${JSON.stringify(fixtureDetail)};u.playList=${JSON.stringify(fixtureLists)};u.recordList=${JSON.stringify(fixtureSongs)};(${settingsStore}).setShowUpdateModal(false);window.__algerCustomTheme.set({enabled:true,transparency:65,darkLift:20});const r=document.querySelector('#app').__vue_app__.config.globalProperties.$router;await r.push('/user')})()`
      );
      const wallpaperArg = process.argv.find((arg) => arg.startsWith('--profile-wallpaper='));
      if (wallpaperArg) {
        const wallpaper = fs
          .readFileSync(wallpaperArg.slice('--profile-wallpaper='.length))
          .toString('base64');
        await evaluate(
          `(()=>{window.__algerCustomTheme.open();const bytes=Uint8Array.from(atob(${JSON.stringify(wallpaper)}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'profile-wallpaper.jpg',{type:'image/jpeg'}));const input=document.querySelector('.ct-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`
        );
        await waitFor(
          `document.documentElement.style.getPropertyValue('--ct-image').includes('blob:')`,
          'custom wallpaper applied'
        );
        await evaluate(`window.__algerCustomTheme.close()`);
      }
      await waitFor(
        `document.querySelectorAll('.user-page .record-item').length===8`,
        'profile fixture loaded'
      );
      await evaluate(
        `(${core}).playMusic=${JSON.stringify(fixtureSongs[0])};(${core}).playMusicUrl=${JSON.stringify(audioUrl)}`
      );
      for (const [width, theme] of [
        [1200, 'dark'],
        [1200, 'light'],
        [900, 'dark']
      ]) {
        await call('Emulation.setDeviceMetricsOverride', {
          width,
          height: 780,
          deviceScaleFactor: 1,
          mobile: false
        });
        await evaluate(
          `if((${settingsStore}).theme!==${JSON.stringify(theme)}) (${settingsStore}).toggleTheme()`
        );
        await evaluate(`(${settingsStore}).setShowUpdateModal(false)`);
        await delay(600);
        await delay(150);
        const surfaces = await evaluate(
          `(()=>{const left=document.querySelector('.user-page .left');const right=document.querySelector('.user-page .right');return {left:getComputedStyle(left).backgroundColor,right:getComputedStyle(right).backgroundColor,nested:getComputedStyle(document.querySelector('.play-list')).backgroundColor,row:getComputedStyle(document.querySelector('.record-item:not(.is-playing)')).backgroundColor,rightEdge:right.getBoundingClientRect().right,viewport:innerWidth,bottom:right.getBoundingClientRect().bottom,viewportHeight:innerHeight,hostBottom:document.querySelector('.main-content').getBoundingClientRect().bottom}})()`
        );
        console.log('PROFILE LAYOUT', width, theme, JSON.stringify(surfaces));
        assert.equal(surfaces.left, surfaces.right, 'Profile surfaces match');
        assert.equal(surfaces.nested, 'rgba(0, 0, 0, 0)', 'No nested opaque block');
        assert.equal(surfaces.row, 'rgba(0, 0, 0, 0)', 'Rows use a shared surface');
        assert.ok(surfaces.rightEdge <= surfaces.viewport, 'Ranking fits the viewport');
        assert.ok(surfaces.bottom <= surfaces.viewportHeight, 'Panels fit below the title bar');
        const shot = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(
          path.join(auditDir, `profile-${width}-${theme}.png`),
          Buffer.from(shot.data, 'base64')
        );
      }
      console.log('PASS profile surfaces, transparent rows and 1200/900px light/dark layouts');
      return;
    }
    const track = (id, url) =>
      JSON.stringify({
        id,
        name: `Smoke ${id}`,
        source: 'netease',
        playMusicUrl: url,
        lyric: {
          lrcTimeArray: benchmark ? Array.from({ length: 45 }, (_, i) => i * 4) : [0],
          lrcArray: benchmark
            ? Array.from({ length: 45 }, (_, i) => ({
                text: `让晚风吹过心中的山海 我们一起走向明天 ${i + 1}`,
                trText: '',
                startTime: i * 4000,
                duration: 4000
              }))
            : [{ text: 'test lyric', trText: '', startTime: 0, duration: 20_000 }]
        },
        backgroundColor: '#222222',
        primaryColor: '#eeeeee',
        picUrl: '',
        ar: [],
        al: { name: '' },
        song: { artists: [], album: { name: '' } }
      });
    const valid = track(910001, audioUrl);
    const broken = track(910002, audioUrl.replace('/song.wav', '/broken.wav'));
    const started = await evaluate(
      `(async()=>{const c=${core}; const ok=await c.handlePlayMusic(${valid},true); return {ok,play:c.play,id:c.playMusic?.id}})()`
    );
    assert.deepEqual(started, { ok: true, play: true, id: 910001 });
    await waitFor(
      `(${core}).playbackStatus === 'playing' && (${core}).isPlay`,
      'actual audio playback'
    );
    const playlist = core.replace("get('playerCore')", "get('playlist')");
    const settingsStore = core.replace("get('playerCore')", "get('settings')");
    await evaluate(`(${settingsStore}).setShowUpdateModal(false)`);
    const toggled = await evaluate(
      `(async()=>{const c=${core}; const p=${playlist}; await p.setPlay({...c.playMusic}); await new Promise(r=>setTimeout(r,150)); const paused=c.playbackStatus==='paused'&&!c.isPlay; await p.setPlay({...c.playMusic}); return {paused,resumed:c.play}})()`
    );
    assert.deepEqual(toggled, { paused: true, resumed: true });
    const failure = await evaluate(
      `(async()=>{const c=${core}; const ok=await c.handlePlayMusic(${broken},true); await new Promise(r=>setTimeout(r,100)); return {ok,play:c.play,phase:c.playbackStatus,bar:document.querySelector('.music-content-name')?.textContent?.trim()}})()`
    );
    assert.equal(failure.ok, false);
    assert.equal(failure.play, false);
    assert.equal(failure.phase, 'failed');
    assert.ok(failure.bar.length > 0);
    const slow = track(910003, audioUrl.replace('/song.wav', '/slow.wav?case=rapid'));
    const newest = track(910004, audioUrl);
    const race = await evaluate(
      `(async()=>{const c=${core}; const old=c.handlePlayMusic(${slow},true); await new Promise(r=>setTimeout(r,100)); const next=c.handlePlayMusic(${newest},true); return await Promise.all([old,next])})()`
    );
    assert.deepEqual(race, [false, true]);
    await waitFor(
      `(${core}).playMusic.id === 910004 && (${core}).playbackStatus === 'playing'`,
      'rapid switching keeps newest track'
    );
    const refreshedSlow = track(910005, audioUrl.replace('/song.wav', '/slow.wav?case=refresh'));
    const refreshedNew = track(910005, audioUrl + '?refreshed=1');
    assert.deepEqual(
      await evaluate(
        `(async()=>{const c=${core}; const old=c.handlePlayMusic(${refreshedSlow},true); await new Promise(r=>setTimeout(r,100)); const next=c.handlePlayMusic(${refreshedNew},true); return await Promise.all([old,next])})()`
      ),
      [false, true]
    );
    const pauseLoading = track(910006, audioUrl.replace('/song.wav', '/slow.wav?case=pause'));
    const loadingPaused = await evaluate(
      `(async()=>{const c=${core}; const pending=c.handlePlayMusic(${pauseLoading},true); await new Promise(r=>setTimeout(r,100)); const loading=c.playbackStatus==='loading'&&!c.isPlay; await c.setPlayMusic(false); const ok=await pending; return {loading,ok,phase:c.playbackStatus,play:c.play}})()`
    );
    assert.deepEqual(loadingPaused, { loading: true, ok: true, phase: 'paused', play: false });
    const restored = await evaluate(
      `(async()=>{const c=${core}; return await c.handlePlayMusic(${valid},true,'source-recovery',{recoveryPositionSeconds:8.25})})()`
    );
    assert.equal(restored, true);
    await delay(1700);
    const logPath = path.join(profile, 'logs', 'playback.log');
    const logs = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(
      logs.some((entry) => entry.event === 'audio.loading' && entry.data.requested?.id === 910003),
      false,
      'Old preload never reaches audio handoff'
    );
    assert.equal(
      logs.some((entry) => entry.event === 'audio.play' && entry.data.requested?.id === 910006),
      false,
      'Pause during loading prevents sound'
    );
    assert.equal(
      logs
        .filter((entry) => entry.event === 'audio.ready' && entry.data.requested?.id === 910005)
        .at(-1)?.data.sourceMatches,
      true,
      'Refreshed URL matches loaded audio'
    );
    assert.equal(
      logs
        .filter(
          (entry) =>
            entry.event === 'playback.preload' && entry.data.positionSource === 'source-recovery'
        )
        .at(-1)?.data.positionSeconds,
      8.25
    );
    const recoveredPosition = logs.filter((entry) => entry.event === 'audio.play').at(-1)
      ?.data.positionSeconds;
    // The media clock can advance between seeking and the playing event.
    assert.ok(
      Math.abs(recoveredPosition - 8.25) < 0.1,
      `Recovery starts near 8.25s, received ${recoveredPosition}`
    );
    const settings = await evaluate(
      `(async()=>{const r=document.querySelector('#app').__vue_app__.config.globalProperties.$router; await r.push('/set'); await new Promise(done=>setTimeout(done,400)); const one=document.querySelectorAll('.settings-page .animate-fade-in').length; [...document.querySelectorAll('.settings-page .cursor-pointer')].find(x=>x.textContent?.trim()==='播放设置')?.click(); await new Promise(done=>setTimeout(done,200)); return {one,switched:document.querySelectorAll('.settings-page .animate-fade-in').length}})()`
    );
    assert.deepEqual(settings, { one: 1, switched: 1 });
    const home = await evaluate(
      `(async()=>{const r=document.querySelector('#app').__vue_app__.config.globalProperties.$router; await r.push('/'); await new Promise(done=>setTimeout(done,400)); return {labels:[...document.querySelectorAll('.app-menu-item-link')].slice(0,2).map(x=>x.getAttribute('aria-label')),columns:getComputedStyle(document.querySelector('.album-section .grid')||document.body).gridTemplateColumns.split(' ').length,width:innerWidth}})()`
    );
    assert.ok(home.labels.every(Boolean));
    if (home.width >= 768 && home.width < 1280) assert.equal(home.columns, 4);
    const visualizer = await evaluate(
      `(async()=>{const c=${core}; c.setMusicFull(true); await new Promise(done=>setTimeout(done,350)); document.querySelector('[title="歌词动画"]')?.click(); await new Promise(done=>setTimeout(done,200)); [...document.querySelectorAll('.folia-style-item')].find(x=>x.textContent?.includes('浮名'))?.click(); await new Promise(done=>setTimeout(done,3200)); const result={mounted:Boolean(document.querySelector('.folia-lyric-stage')),full:c.musicFull,lyricRows:document.querySelectorAll('.music-lrc-text').length,magic:document.querySelector('[title="歌词动画"]')?.className,drawer:document.querySelector('.n-drawer')?.className}; c.setMusicFull(false); return result})()`
    );
    await delay(800);
    const frameLog = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((entry) => entry.event === 'visualizer.frame-sample');
    assert.ok(visualizer.mounted, `Lyric visualizer mounted: ${JSON.stringify(visualizer)}`);
    assert.ok(frameLog, 'Lyric frame sample was recorded');
    if (benchmark) {
      const labels = await evaluate(
        `(async()=>{(${core}).setMusicFull(true); await new Promise(r=>setTimeout(r,250)); document.querySelector('[title="歌词动画"]')?.click(); await new Promise(r=>setTimeout(r,150)); return [...document.querySelectorAll('.folia-style-name')].map(x=>x.textContent?.trim()).filter(x=>x!=='关闭'&&x!=='自动切换')})()`
      );
      const results = [];
      const onlyStyle = process.argv
        .find((arg) => arg.startsWith('--benchmark-only='))
        ?.slice('--benchmark-only='.length);
      for (const label of labels.filter((label) => !onlyStyle || label === onlyStyle)) {
        await evaluate(`(${settingsStore}).setShowUpdateModal(false)`);
        await evaluate(
          `(async()=>{const c=${core}; c.setMusicFull(true); await new Promise(r=>setTimeout(r,200)); if(!document.querySelector('.folia-style-item')) document.querySelector('[title="歌词动画"]')?.click(); await new Promise(r=>setTimeout(r,150)); [...document.querySelectorAll('.folia-style-item')].find(x=>x.querySelector('.folia-style-name')?.textContent?.trim()===${JSON.stringify(label)})?.click(); await new Promise(r=>setTimeout(r,4500));})()`
        );
        const outputPath = process.argv
          .find((arg) => arg.startsWith('--benchmark-output='))
          ?.slice('--benchmark-output='.length);
        if (onlyStyle && outputPath) {
          const shot = await call('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(outputPath.replace(/\.json$/, '.png'), Buffer.from(shot.data, 'base64'));
        }
        await evaluate(`(${core}).setMusicFull(false)`);
        await delay(350);
        const samples = fs
          .readFileSync(logPath, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        const sample = samples.filter((entry) => entry.event === 'visualizer.frame-sample').at(-1);
        const initialized = samples
          .filter(
            (entry) =>
              entry.event === 'visualizer.initialized' && entry.data.style === sample?.data.style
          )
          .at(-1);
        const firstDraw =
          initialized &&
          samples.find(
            (entry) =>
              entry.event === 'visualizer.first-draw' &&
              entry.data.visualizerId === initialized.data.visualizerId
          );
        const renderErrors = initialized
          ? samples.filter(
              (entry) =>
                /visualizer\.(render-error|fallback|shader-error)/.test(entry.event) &&
                entry.data.visualizerId === initialized.data.visualizerId
            ).length
          : 0;
        if (sample?.data.style === 'minions') {
          assert.ok(firstDraw, 'Minions drew their scene');
          assert.equal(renderErrors, 0);
        }
        results.push({
          label,
          ...sample?.data,
          initializationMs: initialized?.data.elapsedMs,
          firstDrawMs: firstDraw?.data.elapsedMs,
          renderErrors
        });
        console.log('BENCH', JSON.stringify(results.at(-1)));
      }
      const outputArg = process.argv.find((arg) => arg.startsWith('--benchmark-output='));
      if (outputArg)
        fs.writeFileSync(
          outputArg.slice('--benchmark-output='.length),
          JSON.stringify({ window: '1200px', lyrics: '45 synthetic timed lines', results }, null, 2)
        );
    }
    const auditArg = process.argv.find((arg) => arg.startsWith('--audit-output='));
    if (auditArg) {
      const auditDir = auditArg.slice('--audit-output='.length);
      fs.mkdirSync(auditDir, { recursive: true });
      const measurements = [];
      const darkAudit = process.argv.includes('--audit-dark-only');
      if (darkAudit)
        await evaluate(`if((${settingsStore}).theme!=='dark') (${settingsStore}).toggleTheme()`);
      for (const width of darkAudit ? [900] : [1200, 900]) {
        await call('Emulation.setDeviceMetricsOverride', {
          width,
          height: 780,
          deviceScaleFactor: 1,
          mobile: false
        });
        for (const route of [
          '/',
          '/search',
          '/list',
          '/album',
          '/toplist',
          '/podcast',
          '/history',
          '/local-music',
          '/user',
          '/set'
        ]) {
          await evaluate(`(${settingsStore}).setShowUpdateModal(false)`);
          const dimensions = await evaluate(
            `(async()=>{const r=document.querySelector('#app').__vue_app__.config.globalProperties.$router; await r.push(${JSON.stringify(route)}); await new Promise(done=>setTimeout(done,900)); const page=document.querySelector('.main-content'); return {route:r.currentRoute.value.path,viewport:innerWidth,pageWidth:page?.clientWidth,scrollWidth:page?.scrollWidth}})()`
          );
          const shot = await call('Page.captureScreenshot', { format: 'png' });
          const name = route === '/' ? 'home' : route.slice(1);
          fs.writeFileSync(
            path.join(auditDir, `${darkAudit ? 'dark-' : ''}${width}-${name}.png`),
            Buffer.from(shot.data, 'base64')
          );
          measurements.push({ width, ...dimensions });
        }
      }
      fs.writeFileSync(
        path.join(auditDir, 'measurements.json'),
        JSON.stringify(measurements, null, 2)
      );
      await call('Emulation.clearDeviceMetricsOverride', {});
      console.log(`PASS captured ${measurements.length} page screenshots for layout review`);
    }
    const localFile = path.join(profile, 'startup-test.wav');
    fs.writeFileSync(localFile, wav);
    const localUrl = `local:///${encodeURIComponent(localFile.replace(/\\/g, '/'))}`;
    const startupTrack = track(910007, localUrl);
    await evaluate(
      `(async()=>{const c=${core}; await c.handlePlayMusic(${startupTrack},false); (${settingsStore}).setSetData({autoPlay:true}); localStorage.setItem('playProgress',JSON.stringify({songId:910007,progress:5})); c.$persist();})()`
    );
    await delay(1000);
    await restart();
    await waitFor(
      `(${core}).playMusic.id === 910007 && (${core}).playbackStatus === 'playing'`,
      'cold startup autoplay'
    );
    // Playback state can be visible before the queued IPC/file log is persisted.
    // Wait for the matching startup result instead of racing the async writer.
    const waitForStartupLog = async (shouldPlay) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const entries = fs
          .readFileSync(logPath, 'utf8')
          .split('\n')
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
        const request = entries
          .filter((entry) => entry.event === 'playback.request' && entry.data.trigger === 'startup')
          .at(-1);
        const result = entries.findLast(
          (entry) =>
            entry.event === 'startup.restore-result' &&
            entry.sessionId === request?.sessionId &&
            entry.data.requestId === request?.data.requestId &&
            entry.data.shouldPlay === shouldPlay
        );
        if (result) return { entries, result };
        await delay(50);
      }
      throw new Error(`Timed out: persisted startup result (shouldPlay=${shouldPlay})`);
    };
    const { entries: startupLogs, result: startupResult } = await waitForStartupLog(true);
    assert.equal(startupResult?.data.loaded, true);
    assert.equal(startupResult?.data.shouldPlay, true);
    assert.equal(
      startupLogs
        .filter(
          (entry) =>
            entry.event === 'audio.loading' && entry.data.requestId === startupResult.data.requestId
        )
        .at(-1)?.data.positionSeconds,
      5
    );
    await evaluate(
      `(async()=>{const c=${core}; await c.handlePause(); (${settingsStore}).setSetData({autoPlay:false}); c.$persist();})()`
    );
    await delay(1000);
    const beforePausedRestart = fs.readFileSync(logPath, 'utf8').trim().split('\n').length;
    await restart();
    await waitFor(
      `(${core}).playMusic.id === 910007 && (${core}).playbackStatus === 'paused'`,
      'cold startup with autoplay disabled'
    );
    const { result: pausedStartupResult } = await waitForStartupLog(false);
    assert.equal(pausedStartupResult.data.loaded, true);
    const pausedStartupLogs = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .slice(beforePausedRestart)
      .map((line) => JSON.parse(line));
    assert.equal(
      pausedStartupLogs.some((entry) => entry.event === 'audio.play'),
      false,
      'Autoplay disabled stays silent'
    );
    console.log(
      'PASS actual playback, pause/resume, source failure, rapid switching, refreshed URL, pause while loading, recovery at 8.25s, cold startup autoplay on/off, settings, home, lyric frame sample'
    );
  } catch (error) {
    const diagnosticPath = path.join(profile, 'logs', 'playback.log');
    if (fs.existsSync(diagnosticPath)) {
      const entries = fs
        .readFileSync(diagnosticPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const outputArg = process.argv.find((arg) => arg.startsWith('--background-audit-output='));
      if (outputArg)
        fs.writeFileSync(
          path.join(outputArg.slice('--background-audit-output='.length), 'failed-events.json'),
          JSON.stringify(entries, null, 2)
        );
      console.error(
        'Last test events:',
        JSON.stringify(
          entries.slice(-14).map((entry) => ({ event: entry.event, data: entry.data }))
        )
      );
    }
    throw error;
  } finally {
    socket?.close();
    app.kill();
    server.close();
    await delay(1500);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
    } catch (error) {
      console.warn('Temporary profile cleanup:', error.message);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
