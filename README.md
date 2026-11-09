> **这是 [algerkong/AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer) 的个人定制版**，基于 v5.1.0，只构建 Windows x64 安装包。
>
> 相对原版的改动：
>
> - 应用图标（程序、快捷方式、任务栏、托盘、侧边栏）换成小猫咪
> - 主界面支持壁纸：点标题栏右上角的调色板按钮，可以更换壁纸、调整界面透明度和夜间模式亮度
> - 全屏歌词动画：打开全屏歌词，点右上角魔法棒，有浮名、流光、倾诉、云阶、回环、心象、静止 7 种样式，可跟随“字体设置”（动画代码来自 [Folia](https://github.com/chthollyphile/folia-major)，见 [NOTICE](./src/renderer/folia/NOTICE.md)）
> - 去掉百度统计、打赏和作者引流内容
> - 自动更新改为从本仓库的 Releases 获取
>
> **下载**：[Releases](https://github.com/aweicjnb/AlgerMusic/releases/latest) 里的 `AlgerMusicPlayer-<版本>-win-x64.exe`。
>
> **发布新版本**：修改 `package.json` 里的 `version`，推送对应的 `v<版本>` 标签，GitHub Actions 会自动构建并发布。
>
> **协议**：因包含 Folia（AGPL-3.0）的代码，本项目按 [GNU AGPL v3.0](./LICENSE) 发布。原项目 AlgerMusicPlayer 使用 MIT 协议，版权归原作者所有，声明保留在 [LICENSE-MIT](./LICENSE-MIT)。以下为原项目说明。

<h2 align="center">🎵 Alger Music Player</h2>

主要功能如下

- 🎵 音乐推荐
- 🔐 账号登录与同步
- 📝 功能
  - 播放历史记录
  - 歌曲收藏管理
  - 歌单 MV 排行榜 每日推荐
  - 自定义快捷键配置（全局或应用内）
- 🎨 界面与交互
  - 沉浸式歌词显示（点击左下角封面进入）
  - 独立桌面歌词窗口
  - 明暗主题切换
  - 迷你模式
  - 状态栏控制
  - 多语言支持
- 🎼 音乐功能
  - 支持歌单、MV、专辑等完整音乐服务
  - 音乐资源解析（基于 @unblockneteasemusic/server）
  - EQ均衡器
  - 定时播放 远程控制播放 倍速播放
  - 高品质音乐
  - 音乐文件下载
  - 搜索 MV 音乐 专辑 歌单 bilibili
  - 音乐单独选择音源解析
- 🚀 技术特性
  - 本地化服务，无需依赖在线API (基于 netease-cloud-music-api)
  - 全平台适配（Desktop & Web & Mobile Web & Android<测试> & ios<后续>）

## 项目简介

一个第三方音乐播放器、本地服务、桌面歌词、音乐下载、最高音质

## 软件截图

![首页白](./docs/image.png)
![首页黑](./docs/image3.png)
![歌词](./docs/image6.png)
![桌面歌词](./docs/image2.png)
![设置页面](./docs/image4.png)
![音乐远程控制](./docs/image5.png)

## 项目启动

```bash
npm install
npm run dev
```

## 开发文档

点击这里[开发文档](./DEV.md)

## 欢迎提Issues

## 声明

本软件仅用于学习交流，禁止用于商业用途，否则后果自负。
希望大家还是要多多支持官方正版，此软件仅用作开发教学。
