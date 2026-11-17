# 播放卡顿诊断日志（版本 3）

日志仍在应用用户目录 `logs/playback.log`；Windows 固定测试版的真实用户目录为 `C:\Users\codin\AppData\Roaming\AlgerMusicPlayer`。新启动的 `app.start` 与 `diagnostics.renderer-start` 应包含 `diagnosticsVersion: 3`。

本轮只做被动观测，不新增媒体捕获、不改变音频路由或缓冲策略、不新增自动暂停/跳进度/重播。日志读输出计数器，不调用统计重置方法。浏览器原有的音频上下文自动恢复行为保持原样。

## 对照时间

- `time`：主进程接收并创建记录的 UTC 时间。
- 每条界面日志的 `rendererTimeMs`、`rendererEpochMs`：发送时的单调时钟与绝对时间；主进程顶层 `rendererToMainDelayMs` 估算消息从界面到主进程的延迟，`logQueuedWrites` 表示写入排队数量。这些值受系统时钟校正及精度影响，不能作为物理声卡测量。
- 音频原生事件的 `eventTimeMs`、`eventEpochMs`：事件创建时间；`eventDispatchDelayMs`：从创建到进入回调的延迟；`callbackTimeMs`：回调执行时点。`trustedEvent: false` 是人为派发事件（专项测试会使用），不应混入真实卡顿统计。
- `audio.buffer-resumed/interrupted` 保留旧 `bufferingMs`（回调间隔），新增 `eventBufferingMs`（事件创建间隔）。二者不同可暴露事件排队；事件创建间隔依然不等于声卡实际静音时长，需和输出时钟、缓冲/线程日志一起判断。
- 所有界面记录包含 `pageVisibility` 和 `windowFocused`，用于区分前台卡住与后台节流。

## 新增观测

| 事件                                                 | 内容与频率                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audio.clock-sample`                                 | 播放中每秒只读采样；第一条约 5 秒，后续正常记录每 30 秒一次。记录媒体进度、当前请求/音源、前方缓冲、AudioContext 时钟、设备输出时间戳/时间戳年龄、采样率和延迟。                                                                                 |
| `audio.clock-gap`                                    | 相邻采样中，媒体进度落后墙钟超过约 150ms，或上下文/输出时钟少推进超过约 200ms。只表示时钟异常线索，不直接判断根因；同类异常最多每 5 秒一条并记录抑制数。暂停、结束和正在 seek 不比较；切歌/上下文/速率变化会标记不连续，seek 后保留 2 秒稳定期。 |
| `audio.output-underrun`                              | 浏览器提供的输出欠载次数/时长增加；记录增量及累计值。与 clock-gap 共用每 5 秒限频。                                                                                                                                                              |
| `audio.context-state`                                | 每个上下文的初始状态、statechange/sinkchange，含上下文编号、是否当前上下文、音频时钟/延迟。仅监听，不添加恢复命令。                                                                                                                              |
| `audio.media-seeking/seeked/ratechange`              | 记录原生进度跳跃与倍速变化，避免把用户操作解释为卡顿。                                                                                                                                                                                           |
| `audio.output-device-*`、`audio.devices-*`           | 设备切换申请/成功/失败/不支持、设备列表变化。只记设备数量、是否自定义/仍存在，不写设备 ID 或名称，也不额外枚举设备。                                                                                                                             |
| `renderer.long-task`                                 | 播放中超过 100ms 的主线程长任务，最多每 5 秒汇总次数、总时长、最大值和第一条的起点；不收集脚本 URL/堆栈。                                                                                                                                        |
| `renderer.scheduler-delay`                           | 每秒定时器在前台迟到 >200ms，后台迟到 >1500ms 时记录；每 5 秒限频。后台记录标记 `backgroundThrottlePossible`，不能直接归为程序卡死。                                                                                                             |
| `app.main-thread-delay`                              | 主进程事件循环采样分辨率 20ms，每 5 秒窗口中若最大延迟 ≥200ms，记录最大/均值/P99、日志排队和主进程内存。                                                                                                                                         |
| `app.page-visibility/page-focus`、`app.window-state` | 页面前后台/焦点，以及原生窗口显示、隐藏、最小化、恢复。                                                                                                                                                                                          |
| `app.system-power`、`app.utility-exit`               | 系统睡眠/恢复及辅助进程退出，和音频事件对时。                                                                                                                                                                                                    |

输出统计检测两种 API：Web Audio 1.1 的 `playbackStats` 用秒，旧 Chromium `playoutStats` 用毫秒，统一转换成 `outputUnderrunMs/Count`、`output*LatencyMs`。`playoutStatsApi: unavailable` 表示运行时不支持或读取失败，绝不伪造零欠载。即使支持，统计也可能受隐私/播放条件影响或缺少声卡驱动级信息，不能据“没有增加”保证没有听感异常。

日志继续使用原有异步写入队列，单条上限 4096 字节、待写上限 128 条、单文件上限 8MiB并保留上一份。新增记录不包含音源 URL、Cookie、歌词正文、录音或原始音频样本。

## 验证命令

```powershell
node --experimental-strip-types --test tests/audioDiagnostics.test.mjs tests/rhythmAnalysis.test.mjs tests/playbackDecision.test.mjs
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --diagnostics-audit-output="D:\algerMusic\stall-diagnostics-audit"
```

专项整机测试使用临时配置、本地 WAV 和实际媒体节点：故意让测试界面线程忙 1.4 秒，随后派发排队的 waiting/playing，验证能保留事件创建间隔、记录长任务与定时器延迟，不会因观测而重新播放/暂停/跳进度。还验证真实输出时钟、上下文状态、seek、暂停时无误报、正常恢复和日志限额。人为事件明确标为不可信并只留在隔离测试的 `diagnostics-events.json`，不写用户真实日志。

API 单位与语义依据：[Web Audio AudioPlaybackStats](https://webaudio.github.io/web-audio-api/#audioplaybackstats)、[早期 Playout Statistics 提案](https://wicg.github.io/audio-context-playout-stats/)。

2026-11-13 本机验证：22 项纯规则/算法/诊断测试、专项实际程序测试和完整播放回归通过。模拟事件的创建间隔 1400ms、回调间隔仅 1ms，记录派发延迟约 1400ms、长任务约 1402ms及定时器迟到约 432ms；观测前后没有新增播放/暂停/seek请求。真实 getOutputTimestamp 可读；本机 Electron 的输出欠载统计 API 不可用，记录为 unavailable。证据在 `D:\algerMusic\stall-diagnostics-audit-20261113\diagnostics-events.json`。这些合成事件只用于验证日志能力，不代表用户真实故障的根因已经修复。
