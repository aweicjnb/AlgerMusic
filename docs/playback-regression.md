# 播放状态与回归验证

卡顿日志字段、限频与专项回归见 [播放诊断说明](./playback-diagnostics.md)。版本 3 增加事件原始时点/派发延迟、主线程阻塞、音频输出时钟和可用的欠载统计；仅观测，不自动重播。

`services/playbackSession.ts` 是播放状态的统一入口。`play` 表示用户希望继续播放，`isPlay` 只在当前音频实际开始播放后为真；`playbackStatus` 区分 idle、loading、playing、paused、failed。旧请求的结果不能修改新请求的状态。页面不得在等待播放请求后再强制设置播放标记。

`playerCore.ts` 在预加载前固定歌曲和 URL，预加载结束后先检查请求再交给 `audioService`。预加载缓存同时区分平台、歌曲 ID 和 URL，避免刷新音源时复用旧实例。恢复位置优先使用故障发生时的媒体位置，其次读取同一首歌保存的进度。

启动顺序：注入 MusicHook、注册音频事件、初始化已选择的落雪音源，然后恢复歌曲。如果用户在准备期间已经选歌，启动恢复会跳过。暂停的音频不能被进度定时器写成 0 秒。

在仓库根目录使用 Node 24 运行：

```powershell
npm run test:playback
npm run test:app -- "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe"
```

整机测试使用同一个 EXE、临时用户数据、本机生成的 WAV 和本机 HTTP 服务；测试后退出测试进程并清理临时数据。覆盖实际播放/暂停、HTTP 503、延迟音源快速切歌、同一歌曲刷新 URL、加载中暂停、8.25 秒恢复、正常退出后的冷启动自动播放开/关、5 秒进度恢复，以及页面和歌词挂载。

歌词同步回归：

```powershell
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --lyric-audit-output="D:\algerMusic\lyric-sync-audit"
```

此模式使用本地歌词接口，测试选中歌曲后歌词才返回、同一 ID 替换歌词、快速切歌、空歌词与无时间戳提示，还验证以下异常处理：

- 加载中、自动重试中、最终失败、确认无歌词显示不同提示。HTTP 503、200 错误载荷、429、408 和真实 10 秒超时可自动恢复；持续失败只尝试三次，不无限循环。实际请求间隔验证为失败后 1 秒和 3 秒。
- 歌词慢响应不阻塞音频开始；自动重试及手动兜底前后的播放请求、音频加载、播放/暂停及跳进度事件保持不变。自动重试期间隐藏手动按钮；最终失败后双击重试只请求一次。
- 重新获取及自动重试绕过磁盘和 IndexedDB 歌词缓存；切歌取消等待计时器和进行中的请求，迟到的旧结果不能覆盖新歌。
- 确认无歌词、解析失败和 HTTP 403 不自动重试；确认无歌词仍可手动刷新。
- 无在线 ID 的本地歌曲不显示无效重试入口；手机布局的失败提示与重试也覆盖。

可加 `--lyric-live-id=25727803` 从本机网易云接口读取指定歌曲的真实歌词，验证解析和显示；音频仍为本机测试 WAV。MusicHook 同时监听平台、ID 和歌词对象，并在异步解析或翻译结束后丢弃旧任务。当前歌曲的歌词请求独立于音频请求，每次 HTTP 超时 10 秒、含缓存读取的单次期限 15 秒；网络、超时、408/429/5xx 最多自动重试两次（失败后等待 1 秒、3 秒），最坏总期限约 49 秒。解析失败及其他永久响应错误直接交给手动处理；手动点击开启新一轮有限尝试，不重新调用歌曲播放。底层 Axios 的歌词通用重试关闭，避免多层叠加。

`ILyric.loadState` 保存 ready/empty/failed，`retryable` 区分暂时与永久失败；未返回结果及当前重试期间显示 loading。桌面和移动端共用 `LyricLoadState.vue`，重试期间显示次数。日志 `lyric.load-start/load-complete/load-failed` 记录读取结果，`lyric.request-start/retry-start/request-result` 记录当前歌词任务及尝试次数，`lyric.auto-retry-scheduled/auto-retry-start/retry-exhausted` 记录延迟、重试及终止，`lyric.display-ready/superseded` 记录展示与丢弃结果，不写歌词正文。回归目录的 `lyric-retry-events.json` 保存模拟接口命中次数、时间和歌词事件供复核。

节奏分析与自动选动画：

```powershell
node --experimental-strip-types --test tests/rhythmAnalysis.test.mjs
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --rhythm-audit-output="D:\algerMusic\rhythm-audit"
```

`services/rhythmAnalysis.ts` 用频谱正向变化与波形 RMS 构成起音强度包络，重采样后做自相关，并结合起音间隔处理半拍/倍拍候选。只保留最近 14 秒的特征，不存录音；支持估算 55～200 BPM。达到至少 6 个起音、约 7 秒样本及连续 3 次稳定估计、置信度 0.62 后才参与匹配。静音、持续长音、节奏不明显或音频图不可读时退回歌词规则，不伪造 BPM。这里是轻量实时估算，不是完整的鼓点分离、曲风分类或拍号/重拍识别；复杂切分、变速和半拍/倍拍仍可能有歧义。

`useAudioRhythm.ts` 仅在桌面全屏歌词可见且选中“自动切换”时采样（20ms 定时器、界面最多每 500ms 更新）。读取 `audioService` 当前实际播放媒体的源节点，独立的无平滑分析支路位于 EQ/音量之前，不连接到扬声器；不请求麦克风、不额外请求/解码整首歌曲，也不调用播放/暂停/跳进度。切歌、媒体时钟跳跃和恢复到前台后重置样本；暂停不积累样本；关闭界面/自动模式时断开分析支路。

自动匹配先按歌词选择，音频稳定后最多修正一次，等到下一歌词行应用；声音的速度、能量作为加分项，保留歌词情绪的主要权重。手动指定动画不受影响。动画菜单的自动项显示近似 BPM、速度和能量；尚未稳定时显示分析/回退提示。日志 `rhythm.start/analysis/reset/unavailable/failed` 和 `visualizer.auto-choice` 记录 BPM、置信度、能量、采样时长和选择依据，不记录音频、URL 或歌词正文。

纯算法测试覆盖 60/72/96/120/150/180 BPM、前奏/定时器抖动、静音/长音/不规则瞬态、静音清除旧结果、跳进度、慢/快动画选择及歌词情绪优先；整机模式播放本机生成的 72/150 BPM WAV，通过真实媒体源/FFT 确认识别与匹配，验证暂停恢复、切歌清除旧结果、不会持续切换或重播、手动样式和持续音回退，拦截媒体捕获 API 确认没有麦克风请求。输出菜单截图及 `rhythm-events.json`。

算法参考：[librosa 节奏分析说明](https://librosa.org/doc/latest/auto_tutorials/01-intro/06-rhythm.html)；分析节点行为参考 [Web Audio 规范](https://www.w3.org/TR/webaudio/#AnalyserNode)。未引入这些项目的运行依赖。

性能和截图选项：

```powershell
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --benchmark --benchmark-output="D:\algerMusic\visualizer-benchmark-latest.json"
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --audit-output="D:\algerMusic\ui-audit-20261111"
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --profile-audit-output="D:\algerMusic\ui-profile-audit" --profile-wallpaper="C:\path\wallpaper.jpg"
```

`--profile-audit-output` 单独检查用户页：使用本机 HTTP 模拟用户、歌单与排行，验证空记录跳过启动恢复、左右面板背景一致、列表内部透明、带播放栏时面板不超出窗口，采集 1200px 深浅主题和 900px 深色主题截图。`--profile-wallpaper` 可选，通过实际壁纸上传流程应用指定图片，所有数据只写入临时测试配置。

`--benchmark-only=小黄人举牌` 只复测指定样式；`--audit-dark-only` 采集 900 像素的夜间页面。短时合成歌词测试用于比较本机表现，不代表真实歌曲的长时间播放或所有第三方音源。实际中途断流仍需结合 transport、audio.buffering、playback.recovery 日志定位。

小黄人使用 Three.js RoomEnvironment 的预计算 PMREM 光照资源，避免进入场景时现场生成。修改光照设置或升级 Three.js 后，可用同一测试程序重新生成资源：

```powershell
node scripts/generate-minion-environment.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe"
```

# 音源失败专项

2026-11-17 新增音源缓存重试、无效备用地址与预加载 403 回归；随后补齐过期上下首重试、UI 点击参数隔离及真实联网音源检查。`--navigation-audit-output` 检查连续导航的归属，`--live-source-audit-output` 配合 `--live-tracks-file` 验证实际网络音频推进；默认完整回归仍使用本机音频。命令、正常用户配置的补充验证及边界见 [source-recovery.md](source-recovery.md)。
