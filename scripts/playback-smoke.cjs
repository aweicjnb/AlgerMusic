// Run against an unpacked AlgerMusicPlayer.exe. Uses a temporary profile and local audio only.
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

const server = http.createServer((request, response) => {
  const route = new URL(request.url, 'http://localhost').pathname;
  if (route === '/broken.wav') {
    response.writeHead(503).end();
    return;
  }
  if (!['/song.wav', '/slow.wav'].includes(route)) {
    response.writeHead(404).end();
    return;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), wav.length - 1) : wav.length - 1;
  const headers = {
    'Content-Type': 'audio/wav',
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*'
  };
  if (match) headers['Content-Range'] = `bytes ${start}-${end}/${wav.length}`;
  const send = () => {
    if (response.destroyed) return;
    response.writeHead(match ? 206 : 200, headers);
    response.end(wav.subarray(start, end + 1));
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
      } catch {}
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
    const waitFor = async (expression, description) => {
      for (let i = 0; i < 80; i++) {
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
        } catch {}
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
    assert.equal(
      logs.filter((entry) => entry.event === 'audio.play').at(-1)?.data.positionSeconds,
      8.25
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
    const startupLogs = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const startupResult = startupLogs
      .filter((entry) => entry.event === 'startup.restore-result')
      .at(-1);
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
