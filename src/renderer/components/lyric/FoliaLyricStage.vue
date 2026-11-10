<template>
  <div ref="hostRef" class="folia-lyric-stage"></div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { buildFoliaLines, buildFoliaTheme, findFoliaLineIndex } from '@/folia/adapter';
import type { FoliaStageHandle } from '@/folia/mount';
import type { FoliaStyle } from '@/folia/styles';
import {
  allTime,
  correctionTime,
  lrcArray,
  lrcTimeArray,
  nowTime,
  playMusic
} from '@/hooks/MusicHook';
import { audioService } from '@/services/audioService';
import { usePlayerStore } from '@/store/modules/player';
import { useSettingsStore } from '@/store/modules/settings';

// 全屏歌词的“浮名”动画（代码来自 Folia，见 src/renderer/folia/NOTICE.md）
const props = defineProps<{ mode: FoliaStyle }>();
const hostRef = ref<HTMLElement | null>(null);
const playerStore = usePlayerStore();
const settingsStore = useSettingsStore();

const lines = computed(() => buildFoliaLines(lrcArray.value, lrcTimeArray.value));
const theme = computed(() =>
  buildFoliaTheme(playMusic.value?.primaryColor, settingsStore.setData.fontFamily)
);
const songKey = computed(() => playMusic.value?.id ?? 'none');
const song = computed(() => {
  const track = playMusic.value;
  const artists = track?.ar?.length ? track.ar : track?.song?.artists;
  return {
    songTitle: track?.name,
    songArtist: artists?.map((artist: { name: string }) => artist.name).join(' / '),
    songAlbum: track?.al?.name || track?.album?.name || track?.song?.album?.name,
    coverUrl: track?.picUrl || track?.al?.picUrl || track?.album?.picUrl,
    duration: allTime.value
  };
});

// 播放器的进度约每 50ms 更新一次，两次更新之间按真实时间补齐，动画才顺滑
const MAX_EXTRAPOLATION_MS = 300;
let syncedTime = nowTime.value;
let syncedAt = performance.now();
const stopTimeWatch = watch(
  nowTime,
  (value) => {
    syncedTime = value;
    syncedAt = performance.now();
  },
  { flush: 'sync' }
);

let handle: FoliaStageHandle | null = null;
let frameId = 0;
let lineIndex = -1;
let disposed = false;

const tick = () => {
  if (!handle) return;
  const elapsed = playerStore.isPlay
    ? Math.min(performance.now() - syncedAt, MAX_EXTRAPOLATION_MS) / 1000
    : 0;
  const time = syncedTime + elapsed + correctionTime.value;
  handle.setTime(time);
  const nextIndex = findFoliaLineIndex(lines.value, time);
  if (nextIndex !== lineIndex) {
    lineIndex = nextIndex;
    handle.setState({ lineIndex });
  }
  frameId = requestAnimationFrame(tick);
};

watch(
  () => props.mode,
  (mode) => {
    audioService.releaseLyricSpectrum();
    handle?.setState({ mode });
  }
);

watch([lines, theme, songKey], () => {
  lineIndex = -1;
  handle?.setState({
    lines: lines.value,
    theme: theme.value,
    songKey: songKey.value,
    lineIndex
  });
});
watch(song, (value) => handle?.setState({ song: value }));

onMounted(async () => {
  document.documentElement.classList.add('folia-stage');
  // React 和动画代码体积较大，用到时才加载
  const { mountFoliaStage } = await import('@/folia/mount');
  if (disposed || !hostRef.value) return;
  handle = mountFoliaStage(
    hostRef.value,
    {
      mode: props.mode,
      lines: lines.value,
      theme: theme.value,
      songKey: songKey.value,
      lineIndex,
      song: song.value
    },
    (bins) => (playerStore.isPlay ? audioService.readLyricSpectrum(bins) : 0)
  );
  frameId = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove('folia-stage');
  disposed = true;
  stopTimeWatch();
  cancelAnimationFrame(frameId);
  audioService.releaseLyricSpectrum();
  handle?.unmount();
  handle = null;
});
</script>

<style scoped>
.folia-lyric-stage {
  position: absolute;
  inset: 0;
}
</style>
