# 来自 Folia 的代码

本目录下的代码取自 [Folia](https://github.com/chthollyphile/folia-major)（提交 `5bdade1`，版本 0.7.27），
版权归 Folia 的作者和贡献者所有，按 **GNU Affero General Public License v3.0** 授权。

已接入本版本的全部 17 种内置歌词样式。最早接入的是浮名（fume）、流光（classic）、倾诉（tilt）、云阶（partita）、回环（claddagh）、心象（cadenza）、静止（still）。后续接入的是商籁（sonnet）、花火（hanabi）、莫奈（monet）、时计（pendolo）、镜台（diorama）、雾笺（nebbia）、群唱（cappella）、绘光（lumiere）、凝彩（tempera）、町景（machi）。目录结构和原项目 `src/` 对齐，方便对照。

## 和原项目的差异

原样复制：`components/visualizer/fume/`（除下述改动）、`colorMix`、`runtime`、`textMeasureCache`、`wordColoring`、
`styleTransition/firstFrame`、`renderQuality/useLyricRenderQuality`，以及 `utils/` 下的文件。

修改：

- `VisualizerFume.tsx`、`VisualizerSubtitleOverlay.tsx`：首行加了 `@jsxImportSource react`，因为本项目默认按 Vue 解析 JSX。
- `VisualizerFume.tsx`：画布容器的居中方式改成 `left-0`。原写法依赖 Tailwind 4 的 `translate` 属性，在本项目的 Tailwind 3 下会被 framer-motion 的 `transform` 覆盖，导致画面偏移半屏。
- `fumeArticleLayout.ts`：删掉了未使用的函数 `chooseFontPx`，否则本项目的类型检查不通过。

为了观感改过的（和原版效果不同）：

- `mount.tsx` 默认关闭每个字点亮前落下的色块（print stamp）。
- `fumeCanvasText.ts`：唱到一个字时，字本身放大落下、落地闪白并炸开圆形柔光，再回弹稳定；相邻的字跟着抬起形成波浪；拖长的字随时间呼吸；点亮和拖尾连续衔接，整行光晕加淡入淡出。只有逐句时间的歌用减弱的版本。
- `fumeTextStyle.ts`：已唱过的句子压暗（0.74/0.58 改为 0.42/0.32）。
- `fumeCameraStep.ts`：换行镜头按距离决定时长（0.42～0.95 秒），全程走正弦缓动，不再用弹簧猛拉。

精简或替换（去掉了对 Folia 播放器、设置、模组系统的依赖）：

- `types.ts`、`components/visualizer/definition.ts`、`components/visualizer/backgrounds/definition.ts`
- `components/visualizer/VisualizerShell.tsx`
- `components/visualizer/preview/frozenPicture.ts`
- `components/visualizer/renderQuality/lyricRenderQualityPin.ts`
- `hooks/usePlayerBottomBarBottomPx.ts`

新增（连接本播放器）：`mount.tsx`、`adapter.ts`、`styles.ts`、`i18n/useTranslation.ts`。

后六种样式目录原样复制，只在 `.tsx` 首行加了 `@jsxImportSource react`，并把 `react-i18next` 换成 `i18n/useTranslation.ts`。部分文件加了 `@ts-nocheck`，因为本项目的类型检查比原项目严格。`GlowWord.tsx` 的波纹居中方式改用 framer-motion 的 `x`/`y`，原因同上面的 Tailwind 差异。

## 后续接入的十种样式

- 保留 Folia 的默认渲染配置和样式素材，包括群唱的内置头像与表情。PixiJS 和 Three.js 渲染器按需加载。
- AlgerMusic 提供歌词、播放进度、歌曲元数据和封面。用当前音频输出的实时频谱驱动有相关效果的样式。Folia 的智能节拍、分轨分析、模组和专属设置页未接入。凝彩用默认图层，莫奈用歌曲封面，町景用默认镜头配置。
- React JSX、翻译入口、类型和宿主接口按 AlgerMusic 调整。移除了依赖 Folia 设置或素材存储的界面接入代码。

### 保留的上游注释

本次新增文件中，以下路径含 Folia 源码的 `@ai-ignore` 注释，已按原文保留。路径相对于 `components/visualizer/`。

- `cappella/cappellaBubbleMetrics.ts`
- `diorama/VisualizerDiorama.tsx`
- `monet/VisualizerMonet.tsx`
- `sonnet/` 下的 `sonnetGlyphLayout.ts`、`sonnetMotion.ts`、`sonnetPostProcess.ts`、`sonnetProgram.ts`、`sonnetTypographyLayout.ts`
- `tempera/` 下的 `createTemperaPixiRuntime.ts`、`temperaCamera.ts`、`temperaCreditsLayer.ts`、`temperaDepth.ts`、`temperaImageTextures.ts`、`temperaInkFlash.ts`、`temperaLayout.ts`、`temperaOverlay.ts`、`temperaProgram.ts`、`temperaSceneBuilder.ts`、`temperaSceneFilters.ts`、`temperaSceneFrame.ts`、`temperaShotFrame.ts`
