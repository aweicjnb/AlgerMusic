# 播放状态与回归验证

`services/playbackSession.ts` 是播放状态的统一入口。`play` 表示用户希望继续播放，`isPlay` 只在当前音频实际开始播放后为真；`playbackStatus` 区分 idle、loading、playing、paused、failed。旧请求的结果不能修改新请求的状态。页面不得在等待播放请求后再强制设置播放标记。

`playerCore.ts` 在预加载前固定歌曲和 URL，预加载结束后先检查请求再交给 `audioService`。预加载缓存同时区分平台、歌曲 ID 和 URL，避免刷新音源时复用旧实例。恢复位置优先使用故障发生时的媒体位置，其次读取同一首歌保存的进度。

启动顺序：注入 MusicHook、注册音频事件、初始化已选择的落雪音源，然后恢复歌曲。如果用户在准备期间已经选歌，启动恢复会跳过。暂停的音频不能被进度定时器写成 0 秒。

在仓库根目录使用 Node 24 运行：

```powershell
npm run test:playback
npm run test:app -- "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe"
```

整机测试使用同一个 EXE、临时用户数据、本机生成的 WAV 和本机 HTTP 服务；测试后退出测试进程并清理临时数据。覆盖实际播放/暂停、HTTP 503、延迟音源快速切歌、同一歌曲刷新 URL、加载中暂停、8.25 秒恢复、正常退出后的冷启动自动播放开/关、5 秒进度恢复，以及页面和歌词挂载。

性能和截图选项：

```powershell
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --benchmark --benchmark-output="D:\algerMusic\visualizer-benchmark-latest.json"
node scripts/playback-smoke.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe" --audit-output="D:\algerMusic\ui-audit-20261111"
```

`--benchmark-only=小黄人举牌` 只复测指定样式；`--audit-dark-only` 采集 900 像素的夜间页面。短时合成歌词测试用于比较本机表现，不代表真实歌曲的长时间播放或所有第三方音源。实际中途断流仍需结合 transport、audio.buffering、playback.recovery 日志定位。

小黄人使用 Three.js RoomEnvironment 的预计算 PMREM 光照资源，避免进入场景时现场生成。修改光照设置或升级 Three.js 后，可用同一测试程序重新生成资源：

```powershell
node scripts/generate-minion-environment.cjs "D:\algerMusic\AlgerMusic-visualizers-test\AlgerMusicPlayer.exe"
```
