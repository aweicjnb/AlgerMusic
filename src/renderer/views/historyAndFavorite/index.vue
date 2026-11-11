<template>
  <div class="history-page flex gap-6 h-full pb-4 page-padding pt-6 bg-white dark:bg-black">
    <favorite class="flex-item" v-if="!isMobile" />
    <history-list class="flex-item" />
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: 'History'
});

import { isMobile } from '@/utils';
import Favorite from '@/views/favorite/index.vue';
import HistoryList from '@/views/history/index.vue';
</script>

<style scoped>
.flex-item {
  @apply flex-1 min-w-0 bg-gray-50 dark:bg-neutral-900/50 rounded-3xl overflow-hidden border border-gray-100 dark:border-neutral-800 transition-all duration-300;
}
@media (min-width: 769px) and (max-width: 1023px) {
  .history-page {
    flex-direction: column;
    overflow-y: auto;
    padding-bottom: 7rem;
  }
  .flex-item {
    flex: none;
    height: 520px;
  }
  .flex-item:last-child {
    order: -1;
  }
}
</style>
