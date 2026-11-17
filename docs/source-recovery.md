# 音源失败、预加载与本地音频修正（2026-11-17）

## 后续热修：真实音源拒绝与过期切歌重试

用户随后反馈多数歌曲不能播放。此前的本地音频和模拟音源回归不足以覆盖真实接口及连续切歌；不能沿用下文首轮验收来宣称实际播放已经恢复。

- 用户 22:21—22:24 会话中的官方音源请求出现 HTTP 400、业务码 -460。直接验证已安装 API 包，默认调用返回“网络环境存在风险”；同一包支持的 `crypto=weapi` 调用能为《Old Memory》《起风了》返回完整地址。`getMusicUrl` 现在显式传此参数，关闭这一请求的通用重复重试，保留原登录与音源降级流程；不保证所有歌曲都有可用地址。
- 旧 `_nextPlay` 的失败重试/跳过定时器没有归属校验，可能继续替换用户后来选择的歌曲。前轮让正式播放绕过失败缓存后，这些旧自动重试也会被当成正式请求，扩大重复解析。现在由导航版本及播放请求 ID 共同约束；手动选歌、上下首、替换/清空列表使旧导航失效。上一首的迟到失败不能再删除新导航中的列表项；当前导航自身删除失败项后仍可继续。
- 上下首公开方法忽略 UI 点击参数，避免 MouseEvent 被传入内部的重试次数。自动重试标记 `trigger=playlist-retry`，不清失败冷却；用户新的选择仍可立即重试。
- 官方请求收到当前播放的 AbortSignal；旧请求取消后不再进入额外的备用解析。核心播放将旧请求的异常记录为 `playback.superseded`，不误算成当前歌曲失败。下一首预加载由核心统一安排，执行前检查请求，避免重复/过期任务。

新增两类独立整机检查，均使用临时配置并在结束后清理；第二类明确使用真实网络源，不替换 API 响应或媒体 URL：

```powershell
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --navigation-audit-output="D:\algerMusic\navigation-hotfix-audit-20261117"
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --live-source-audit-output="D:\algerMusic\live-source-hotfix-audit-20261117" --live-tracks-file="D:\algerMusic\live-playback-tracks-20261117.json"
```

导航检查覆盖失败后新选择、进行中的上一首被替换、真实点击事件、自动重试冷却、移除失败项后继续；真实音源检查使用公开歌曲元数据及当前启用的 kugou/migu/pyncmd。输出 `navigation-events.json`、`live-events.json`，后者检查真实音频时间推进，而非只检查解析成功。

另外通过工作区外的 `verify-real-profile-playback-20261117.cjs` 验证正常用户配置：只在无现有进程时启动同一个程序，通过应用原有播放流程选择歌曲，不读取登录凭据、不更改源设置、不清用户配置。实测《黑夜问白天》《Old Memory》《起风了》均进入 playing，6 秒窗口实际推进约 6 秒；结果保存在 `D:/algerMusic/real-profile-playback-results-20261117.json`。这些是短时联网播放验证，不代表所有曲目或所有长时间卡顿已解决。

## 首轮修正

修正真实日志中“无效备用服务地址”“正式播放仍命中失败缓存”“预加载拒绝未处理”，并修复复现出的本地 MP3 恢复进度读取失败。

- 可选的外部备用服务只接受完整的 HTTP/HTTPS 根地址。缺少 `VITE_API_MUSIC`、占位符或相对路径时不发送请求，记录 `source.parser-fallback` 的 `reason=unconfigured/outcome=skipped`，并返回明确的不可用结果。配置有效时仍请求该根地址下的 `/music`，保留 10 秒超时及 HTTP 错误传播。此修正不会创建一个外部音源服务；内置音源或用户插件仍需实际找到歌曲。
- 正式播放请求（`trigger=request`，包括用户选择歌曲和失败后再次播放）携带 `retrySourceFailures=true`。解析器在进入各策略前清除该策略的内存失败缓存，避免后台预加载留下的一分钟冷却阻止实际播放。后台预加载、启动恢复和音源自动恢复保留原有限流行为。进入策略前再次验证请求，旧歌曲不得清除缓存或继续解析。
- `clearMusicCache` 先清除实际使用的内存失败缓存，再清理 URL 缓存及旧版 IndexedDB 记录，包括落雪策略；即使 IndexedDB 出错也能清内存。
- 下一首预加载现在等待并捕获加载拒绝。`preload.start/ready/failed` 记录目标歌曲、当前选择、音源种类和耗时；失败包含安全错误分类。不会写入 URL、凭据，不会把下一首的失败改写为当前歌失败或重播当前歌。底层失败 Howl 沿用原有 unload 清理。
- `shared/localMedia.ts` 在实际创建/交接音频时把本地 URL 规范为原生 `file://`，让 Chromium 的标准文件加载器处理分段读取和 seek。持久化歌曲、缓存键继续使用原 `local://` 格式；预加载和音频服务使用同一个转换，诊断绑定也对应实际源，避免 sourceMatches 失真。转换保留 Windows/UNC/POSIX 文件位置及中文、空格、转义字符，网络地址保持原值。

## 检查与实际程序回归

```powershell
node --experimental-strip-types --test tests/localMedia.test.mjs tests/sourceRecovery.test.mjs tests/audioDiagnostics.test.mjs tests/rhythmAnalysis.test.mjs tests/playbackDecision.test.mjs
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --source-audit-output="D:\algerMusic\source-recovery-audit-20261117"
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --background-audit-output="D:\algerMusic\background-playback-audit-20261117"
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe"
```

五项音源测试覆盖未配置/占位地址无请求、本地 HTTP 服务成功及 503、后台失败缓存与正式播放的立即重试、数据库失败下清除内存、旧请求不得继续解析。六项本地地址测试覆盖盘符、UNC、POSIX、中文/转义字符、网络源身份与非法地址。结合原有测试共 33 项。

整机音源专项使用临时配置、本地 HTTP 响应及测试内存音源，验证真实正式播放链路会再次尝试失败策略；下一首 403 不产生未处理异常或打断当前歌曲，修复地址后能再次预加载。窗口专项分别播放本地与 HTTP WAV，对比前台/最小化/托盘隐藏的媒体推进和请求次数。

本机用同一份 464.63 秒《蘅芜》MP3 复现：旧本地 URL 从 390 秒恢复时 mediaError2 并触发换源，而 HTTP 或原生文件 URL 可以恢复。修正后的实际程序从 390 秒起播，sourceMatches=true，无 media/load error 或额外恢复。不能把这项可复现故障等同于此前所有系统调度类短停顿；这些场景仍需根据后续真实日志观察。

真实曲专项可增加 `--real-audio-file=<已有MP3路径> --background-seek=390 --background-phase-ms=30000 --background-modes=tray`，分别用本机 HTTP 与原生本地文件回放同一份数据。原文件只读，临时配置下的副本自动清理；每个阶段验证实际开始位置、媒体推进、暂停状态和请求次数。

本轮验收：33 项测试、类型/代码检查、完整构建及完整播放回归通过。音源专项确认预加载 403 隔离、失败后立即重试、清除缓存；真实 MP3 两种来源各 30 秒从 390 秒到 421 秒，sourceMatches=true，未出现媒体错误、时钟异常、自动恢复或重播。证据位于工作区外的 `source-recovery-audit-20261117/source-events.json`、`real-mp3-native-regression-20261117/background-events.json`。
