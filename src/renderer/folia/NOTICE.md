# 来自 Folia 的代码

本目录下的代码取自 [Folia](https://github.com/chthollyphile/folia-major)（提交 `5bdade1`，版本 0.7.27），
版权归 Folia 的作者和贡献者所有，按 **GNU Affero General Public License v3.0** 授权。

目前包含浮名（fume）、流光（classic）、倾诉（tilt）、云阶（partita）、回环（claddagh）、心象（cadenza）、静止（still）七种歌词动画。目录结构和原项目 `src/` 保持一致，方便对照。

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
