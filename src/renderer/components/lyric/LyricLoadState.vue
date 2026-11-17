<template>
  <div
    v-if="lyricLoadStatus !== 'idle' && lyricLoadStatus !== 'ready'"
    class="lyric-load-state"
    :class="{ compact }"
    :data-lyric-status="lyricLoadStatus"
    :data-lyric-retry-attempt="lyricRetryAttempt"
    :role="lyricLoadStatus === 'failed' ? 'alert' : 'status'"
    aria-live="polite"
  >
    <div class="state-message">
      <i
        v-if="lyricLoadStatus === 'loading'"
        class="ri-loader-4-line animate-spin"
        aria-hidden="true"
      />
      <span>{{ t(messageKey, { attempt: lyricRetryAttempt, total: lyricAutoRetryLimit }) }}</span>
    </div>
    <button
      v-if="canRetryLyrics"
      type="button"
      class="lyric-retry"
      @click.stop="retryCurrentLyrics"
      @keyup.stop
    >
      <i class="ri-refresh-line" aria-hidden="true" />
      {{ t(lyricLoadStatus === 'failed' ? 'player.lrc.retry' : 'player.lrc.refresh') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  canRetryLyrics,
  lyricAutoRetryLimit,
  lyricLoadStatus,
  lyricRetryAttempt,
  retryCurrentLyrics
} from '@/hooks/MusicHook';

defineProps<{ compact?: boolean }>();
const { t } = useI18n();
const messageKey = computed(() => {
  if (lyricLoadStatus.value === 'loading')
    return lyricRetryAttempt.value > 0 ? 'player.lrc.autoRetrying' : 'player.lrc.loading';
  if (lyricLoadStatus.value === 'failed') return 'player.lrc.loadFailed';
  return 'player.lrc.noLrc';
});
</script>

<style scoped>
.lyric-load-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 160px;
  padding: 24px 12px;
  color: var(--text-color-active, currentColor);
  font-size: 16px;
  line-height: 1.6;
  text-align: center;
}
.state-message {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.8;
}
.lyric-retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border: 1px solid rgb(128 128 128 / 0.3);
  border-radius: 999px;
  background: rgb(128 128 128 / 0.14);
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}
.lyric-retry:hover {
  background: rgb(128 128 128 / 0.25);
}
.lyric-retry:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 3px;
}
.compact {
  min-height: 0;
  gap: 8px;
  padding: 8px;
}
</style>
