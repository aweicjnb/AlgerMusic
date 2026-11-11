import { cloneDeep } from 'lodash';
import { createDiscreteApi } from 'naive-ui';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import i18n from '@/../i18n/renderer';
import { getParsingMusicUrl } from '@/api/music';
import { useLyrics, useSongDetail } from '@/hooks/usePlayerHooks';
import { audioService } from '@/services/audioService';
import { chooseResumePosition, isCurrentPlaybackAttempt } from '@/services/playbackDecision';
import { playbackRequestManager } from '@/services/playbackRequestManager';
import {
  createPlaybackSession,
  type PlaybackEvent,
  type PlaybackFailure,
  reducePlaybackSession
} from '@/services/playbackSession';
import { preloadService } from '@/services/preloadService';
import { SongSourceConfigManager } from '@/services/SongSourceConfigManager';
import type { AudioOutputDevice } from '@/types/audio';
import type { Platform, SongResult } from '@/types/music';
import { getImgUrl } from '@/utils';
import { getImageLinearBackground } from '@/utils/linearColor';
import {
  audioSourceKind,
  bindPlaybackMedia,
  logPlayback,
  logTrack,
  playbackErrorFields
} from '@/utils/playbackLog';

import { usePlayHistoryStore } from './playHistory';

const { message } = createDiscreteApi(['message']);
type PlaybackTrigger = 'request' | 'startup' | 'play-error' | 'start-timeout' | 'source-recovery';
interface PlaybackOrigin {
  parentRequestId?: string;
  parentAudioAttempt?: number;
  recoveryPositionSeconds?: number;
}

/**
 * 核心播放控制 Store
 * 负责：播放/暂停、当前歌曲、音频URL、音量、播放速度、全屏状态
 */
export const usePlayerCoreStore = defineStore(
  'playerCore',
  () => {
    // ==================== 状态 ====================
    const playbackSession = ref(createPlaybackSession());
    const playbackStatus = computed(() => playbackSession.value.phase);
    const play = computed(() => playbackSession.value.wantsPlay);
    const isPlay = computed(() => playbackStatus.value === 'playing');
    const playMusic = ref<SongResult>({} as SongResult);
    const playMusicUrl = ref('');
    const musicFull = ref(false);
    const playbackRate = ref(1.0);
    const volume = ref(1);
    // 播放意图与 play 使用同一个状态，避免暂停后留下旧的“仍想播放”标记。
    const userPlayIntent = computed(() => play.value);
    const failedTrackId = computed(() =>
      playbackSession.value.failure === 'missing-source' ? (playMusic.value.id ?? null) : null
    );
    const isFmPlaying = ref(false); // 是否正在播放私人FM

    // 音频输出设备
    const audioOutputDeviceId = ref<string>(
      localStorage.getItem('audioOutputDeviceId') || 'default'
    );
    const availableAudioDevices = ref<AudioOutputDevice[]>([]);

    let checkPlayTime: NodeJS.Timeout | null = null;
    let clearPlaybackCheck: (() => void) | null = null;
    let checkPlaybackRetryCount = 0;
    const MAX_CHECKPLAYBACK_RETRIES = 3;

    // ==================== Computed ====================
    const currentSong = computed(() => playMusic.value);
    const isPlaying = computed(() => isPlay.value);

    // ==================== Actions ====================

    /**
     * 设置播放状态
     */
    const updatePlayback = (event: PlaybackEvent) => {
      const previous = playbackSession.value;
      const next = reducePlaybackSession(previous, event);
      if (next === previous) return;
      playbackSession.value = next;
      playMusic.value.playLoading = next.phase === 'loading';
      if (next.phase !== previous.phase) {
        logPlayback('playback.state', {
          requestId: next.requestId,
          previous: previous.phase,
          phase: next.phase,
          shouldPlay: next.wantsPlay,
          failure: next.failure
        });
      }
      window.electron?.ipcRenderer.send('update-play-state', next.phase === 'playing');
    };
    const setIsPlay = (value: boolean) => {
      updatePlayback({ type: 'intent', wantsPlay: value });
      if (!value) clearPlaybackCheck?.();
      else if (audioService.isActuallyPlaying()) onAudioPlaying();
    };
    const onAudioPlaying = () => {
      const audio = audioService.getPlaybackDiagnostics();
      if (
        !isCurrentPlaybackAttempt({
          requestId: audio.audioRequestId,
          currentRequestId: playbackSession.value.requestId,
          selectedTrack: playMusic.value,
          audioTrack: audioService.getCurrentTrack(),
          expectedSound: audioService.getCurrentSound(),
          currentSound: audioService.getCurrentSound()
        })
      )
        return;
      if (!play.value) {
        audioService.getCurrentSound()?.pause();
        return;
      }
      updatePlayback({ type: 'playing', requestId: playbackSession.value.requestId });
    };
    const onAudioPaused = () => {
      updatePlayback({ type: 'paused', requestId: playbackSession.value.requestId });
      clearPlaybackCheck?.();
    };
    const failPlayback = (
      failure: PlaybackFailure,
      requestId = playbackSession.value.requestId
    ) => {
      if (requestId !== playbackSession.value.requestId) return;
      audioService.discardCurrentSound();
      clearPlaybackCheck?.();
      updatePlayback({ type: 'failed', requestId, failure });
    };

    /**
     * 设置全屏状态
     */
    const setMusicFull = (value: boolean) => {
      musicFull.value = value;
    };

    /**
     * 设置播放速度
     */
    const setPlaybackRate = (rate: number) => {
      playbackRate.value = rate;
      audioService.setPlaybackRate(rate);
    };

    /**
     * 设置音量
     */
    const setVolume = (newVolume: number) => {
      const normalizedVolume = Math.max(0, Math.min(1, newVolume));
      volume.value = normalizedVolume;
      audioService.setVolume(normalizedVolume);
    };

    /**
     * 获取音量
     */
    const getVolume = () => volume.value;

    /**
     * 增加音量
     */
    const increaseVolume = (step: number = 0.1) => {
      const newVolume = Math.min(1, volume.value + step);
      setVolume(newVolume);
      return newVolume;
    };

    /**
     * 减少音量
     */
    const decreaseVolume = (step: number = 0.1) => {
      const newVolume = Math.max(0, volume.value - step);
      setVolume(newVolume);
      return newVolume;
    };

    /**
     * 播放状态检测
     * 在播放开始后延迟检查音频是否真正在播放，防止无声播放
     */
    const checkPlaybackState = (song: SongResult, requestId?: string, timeout: number = 6000) => {
      clearPlaybackCheck?.();
      const sound = audioService.getCurrentSound();
      if (!sound) return;

      // 如果没有提供 requestId，创建一个临时标识
      const actualRequestId = requestId || `check_${Date.now()}`;
      const checkStartedAt = performance.now();
      const checkDiagnostics = () => ({
        ...audioService.getPlaybackDiagnostics(),
        requestId: actualRequestId,
        currentRequestId: playbackRequestManager.getCurrentRequestId(),
        requested: logTrack(song),
        selected: logTrack(playMusic.value),
        sameSound: sound === audioService.getCurrentSound(),
        shouldPlay: play.value,
        userPlayIntent: userPlayIntent.value,
        timeoutMs: timeout,
        elapsedMs: Math.round(performance.now() - checkStartedAt)
      });
      const isCurrentCheck = () =>
        isCurrentPlaybackAttempt({
          requestId,
          currentRequestId: playbackRequestManager.getCurrentRequestId(),
          selectedTrack: playMusic.value,
          audioTrack: audioService.getCurrentTrack(),
          expectedSound: sound,
          currentSound: audioService.getCurrentSound()
        }) && song.id === playMusic.value.id;
      const cleanup = () => {
        audioService.off('play', onPlayHandler);
        audioService.off('playerror', onPlayErrorHandler);
        if (checkPlayTime) {
          clearTimeout(checkPlayTime);
          checkPlayTime = null;
        }
        if (clearPlaybackCheck === cleanup) clearPlaybackCheck = null;
      };

      const onPlayHandler = () => {
        if (!isCurrentCheck()) {
          logPlayback('playback.check-skipped', { ...checkDiagnostics(), reason: 'stale-play' });
          cleanup();
          return;
        }
        console.log(`[${actualRequestId}] 播放事件触发，歌曲成功开始播放`);
        cleanup();
        checkPlaybackRetryCount = 0; // 播放成功，重置重试计数
      };

      const onPlayErrorHandler = async () => {
        if (!isCurrentCheck()) {
          logPlayback('playback.check-skipped', {
            ...checkDiagnostics(),
            reason: 'stale-playerror'
          });
          cleanup();
          return;
        }
        console.log('播放错误事件触发，检查是否需要重新获取URL');
        cleanup();

        // 如果有 requestId，验证其有效性
        if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
          console.log('请求已过期，跳过重试');
          logPlayback('playback.retry-skipped', {
            ...checkDiagnostics(),
            reason: 'play-error',
            stage: 'superseded'
          });
          return;
        }

        // 检查重试次数限制
        if (checkPlaybackRetryCount >= MAX_CHECKPLAYBACK_RETRIES) {
          logPlayback('playback.retry-limit', { ...checkDiagnostics(), reason: 'play-error' });
          console.warn(`播放重试已达上限 (${MAX_CHECKPLAYBACK_RETRIES} 次)，停止重试`);
          checkPlaybackRetryCount = 0;
          setPlayMusic(false);
          return;
        }

        if (play.value) {
          checkPlaybackRetryCount++;
          logPlayback('playback.retry', {
            ...checkDiagnostics(),
            reason: 'play-error',
            attempt: checkPlaybackRetryCount
          });
          console.log(
            `播放失败，尝试刷新URL并重新播放 (重试 ${checkPlaybackRetryCount}/${MAX_CHECKPLAYBACK_RETRIES})`
          );
          // 本地音乐不需要刷新 URL
          if (!playMusic.value.playMusicUrl?.startsWith('local://')) {
            playMusic.value.playMusicUrl = undefined;
          }
          const refreshedSong = { ...song, isFirstPlay: true };
          await handlePlayMusic(refreshedSong, true, 'play-error', {
            parentRequestId: actualRequestId,
            parentAudioAttempt: audioService.getPlaybackDiagnostics().audioAttempt
          });
        } else {
          logPlayback('playback.retry-skipped', {
            ...checkDiagnostics(),
            reason: 'play-error',
            stage: 'paused'
          });
        }
      };

      audioService.on('play', onPlayHandler);
      audioService.on('playerror', onPlayErrorHandler);
      clearPlaybackCheck = cleanup;

      checkPlayTime = setTimeout(() => {
        if (!isCurrentCheck()) {
          logPlayback('playback.check-skipped', { ...checkDiagnostics(), reason: 'stale-timeout' });
          cleanup();
          return;
        }
        // 如果有 requestId，验证其有效性
        if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
          console.log('请求已过期，跳过超时重试');
          logPlayback('playback.retry-skipped', {
            ...checkDiagnostics(),
            reason: 'start-timeout',
            stage: 'superseded'
          });
          cleanup();
          return;
        }

        // 双重确认：Howler 报告未播放 + 用户仍想播放
        // 额外检查底层 HTMLAudioElement 的状态，避免 EQ 重建期间的误判
        const currentSound = audioService.getCurrentSound();
        let htmlPlaying = false;
        if (currentSound) {
          try {
            const sounds = (currentSound as any)._sounds as any[];
            if (sounds?.[0]?._node instanceof HTMLMediaElement) {
              const node = sounds[0]._node as HTMLMediaElement;
              htmlPlaying = !node.paused && !node.ended && node.readyState > 2;
            }
          } catch {
            // 静默忽略
          }
        }

        if (htmlPlaying) {
          // 底层 HTMLAudioElement 实际在播放，不需要重试
          console.log('底层音频元素正在播放，跳过超时重试');
          logPlayback('playback.retry-skipped', {
            ...checkDiagnostics(),
            reason: 'start-timeout',
            stage: 'media-playing'
          });
          cleanup();
          return;
        }

        if (!audioService.isActuallyPlaying() && play.value) {
          cleanup();

          // 检查重试次数限制
          if (checkPlaybackRetryCount >= MAX_CHECKPLAYBACK_RETRIES) {
            logPlayback('playback.retry-limit', {
              ...checkDiagnostics(),
              reason: 'start-timeout'
            });
            console.warn(`超时重试已达上限 (${MAX_CHECKPLAYBACK_RETRIES} 次)，停止重试`);
            checkPlaybackRetryCount = 0;
            setPlayMusic(false);
            return;
          }

          checkPlaybackRetryCount++;
          logPlayback('playback.retry', {
            ...checkDiagnostics(),
            reason: 'start-timeout',
            attempt: checkPlaybackRetryCount
          });
          console.log(
            `${timeout}ms后歌曲未真正播放，尝试重新获取URL (重试 ${checkPlaybackRetryCount}/${MAX_CHECKPLAYBACK_RETRIES})`
          );

          // 本地音乐不需要刷新 URL
          if (!playMusic.value.playMusicUrl?.startsWith('local://')) {
            playMusic.value.playMusicUrl = undefined;
          }
          (async () => {
            const refreshedSong = { ...song, isFirstPlay: true };
            await handlePlayMusic(refreshedSong, true, 'start-timeout', {
              parentRequestId: actualRequestId,
              parentAudioAttempt: audioService.getPlaybackDiagnostics().audioAttempt
            });
          })();
        } else {
          cleanup();
        }
      }, timeout);
    };

    /**
     * 核心播放处理函数
     */
    const handlePlayMusic = async (
      music: SongResult,
      shouldPlay = true,
      trigger: PlaybackTrigger = 'request',
      origin?: PlaybackOrigin
    ) => {
      // 如果是新歌曲，重置已尝试的音源和重试计数
      if (music.id !== playMusic.value.id) {
        SongSourceConfigManager.clearTriedSources(music.id);
        checkPlaybackRetryCount = 0;
      }

      // 创建新的播放请求并取消之前的所有请求
      const requestStartedAt = performance.now();
      const previousRequestId = playbackRequestManager.getCurrentRequestId();
      const requestId = playbackRequestManager.createRequest(music);
      clearPlaybackCheck?.();
      const requested = logTrack(music);
      const requestLog = { requestId, trigger, requested, ...origin };
      const requestState = () => ({
        ...requestLog,
        currentRequestId: playbackRequestManager.getCurrentRequestId(),
        elapsedMs: Math.round(performance.now() - requestStartedAt)
      });
      logPlayback('playback.request', {
        ...requestLog,
        previousRequestId,
        selected: logTrack(playMusic.value),
        audioTrack: logTrack(audioService.getCurrentTrack()),
        shouldPlay,
        sourceKind: audioSourceKind(music.playMusicUrl)
      });
      console.log(`[handlePlayMusic] 开始处理歌曲: ${music.name}, 请求ID: ${requestId}`);

      const currentSound = audioService.getCurrentSound();
      if (currentSound) {
        console.log('主动停止并卸载当前音频实例');
        if (currentSound.state() !== 'unloaded') {
          logPlayback('playback.replacing-audio', {
            ...requestState(),
            ...audioService.getPlaybackDiagnostics(currentSound)
          });
        }
      }
      audioService.discardCurrentSound();
      playMusicUrl.value = '';
      playMusic.value = { ...music };
      updatePlayback({ type: 'begin', requestId, wantsPlay: shouldPlay });

      // 验证请求是否仍然有效
      if (!playbackRequestManager.isRequestValid(requestId)) {
        console.log(`[handlePlayMusic] 请求已失效: ${requestId}`);
        logPlayback('playback.superseded', { ...requestState(), stage: 'before-activation' });
        return false;
      }

      // 激活请求
      if (!playbackRequestManager.activateRequest(requestId)) {
        console.log(`[handlePlayMusic] 无法激活请求: ${requestId}`);
        logPlayback('playback.failed', { ...requestState(), stage: 'activation' });
        return false;
      }

      const originalMusic = { ...music };

      const { loadLrc } = useLyrics();
      const { getSongDetail } = useSongDetail();

      // 并行加载歌词和背景色
      const metadata = Promise.all([
        (async () => {
          if (music.lyric && music.lyric.lrcTimeArray.length > 0) {
            return music.lyric;
          }
          return await loadLrc(music.id);
        })(),
        (async () => {
          if (music.backgroundColor && music.primaryColor) {
            return { backgroundColor: music.backgroundColor, primaryColor: music.primaryColor };
          }
          return await getImageLinearBackground(getImgUrl(music?.picUrl, '30y30'));
        })()
      ]);
      let metadataResult: Awaited<typeof metadata>;
      try {
        metadataResult = await metadata;
      } catch (error) {
        logPlayback('playback.failed', {
          ...requestState(),
          stage: 'metadata',
          ...playbackErrorFields(error)
        });
        if (playbackRequestManager.isRequestValid(requestId)) {
          failPlayback('metadata', requestId);
          message.error(i18n.global.t('player.playbackRetry'));
        }
        playbackRequestManager.failRequest(requestId);
        return false;
      }
      const [lyrics, { backgroundColor, primaryColor }] = metadataResult;

      // 在更新状态前再次验证请求
      if (!playbackRequestManager.isRequestValid(requestId)) {
        console.log(`[handlePlayMusic] 加载歌词/背景色后请求已失效: ${requestId}`);
        logPlayback('playback.superseded', { ...requestState(), stage: 'metadata' });
        return false;
      }

      // 设置歌词和背景色
      music.lyric = lyrics;
      music.backgroundColor = backgroundColor;
      music.primaryColor = primaryColor;
      music.playLoading = true;

      // 更新 playMusic 和播放状态
      playMusic.value = music;
      music.playLoading = true;

      // 更新标题
      let title = music.name;
      if (music.source === 'netease' && music?.song?.artists) {
        title += ` - ${music.song.artists.reduce(
          (prev: string, curr: any) => `${prev}${curr.name}/`,
          ''
        )}`;
      }
      document.title = 'AlgerMusic - ' + title;

      try {
        // 添加到历史记录
        const playHistoryStore = usePlayHistoryStore();
        if (music.isPodcast) {
          if (music.program) {
            playHistoryStore.addPodcast(music.program);
          }
        } else {
          playHistoryStore.addMusic(music);
        }

        // 获取歌曲详情
        const updatedPlayMusic = await getSongDetail(originalMusic, requestId);

        // 在获取详情后再次验证请求
        if (!playbackRequestManager.isRequestValid(requestId)) {
          console.log(`[handlePlayMusic] 获取歌曲详情后请求已失效: ${requestId}`);
          logPlayback('playback.superseded', { ...requestState(), stage: 'source' });
          playbackRequestManager.failRequest(requestId);
          return false;
        }

        updatedPlayMusic.lyric = lyrics;

        playMusic.value = updatedPlayMusic;
        playMusic.value.playLoading = true;
        playMusicUrl.value = updatedPlayMusic.playMusicUrl as string;
        music.playMusicUrl = updatedPlayMusic.playMusicUrl as string;
        logPlayback('playback.source-resolved', {
          ...requestState(),
          selected: logTrack(updatedPlayMusic),
          sourceKind: audioSourceKind(playMusicUrl.value)
        });

        // 在拆分后补充：触发预加载下一首/下下首（与 playlist store 保持一致）
        try {
          const { usePlaylistStore } = await import('./playlist');
          const playlistStore = usePlaylistStore();
          // 基于当前歌曲在播放列表中的位置来预加载
          const list = playlistStore.playList;
          if (Array.isArray(list) && list.length > 0) {
            const idx = list.findIndex(
              (item: SongResult) =>
                item.id === updatedPlayMusic.id && item.source === updatedPlayMusic.source
            );
            if (idx !== -1) {
              setTimeout(() => {
                playlistStore.preloadNextSongs(idx);
              }, 3000);
            }
          }
        } catch (e) {
          console.warn('预加载触发失败（可能是依赖未加载或循环依赖），已忽略:', e);
        }

        try {
          const result = await playAudio(requestId, origin?.recoveryPositionSeconds);

          if (result) {
            // 播放成功，清除 isFirstPlay 标记，避免暂停时被误判为新歌
            playMusic.value.isFirstPlay = false;
            playbackRequestManager.completeRequest(requestId);
            logPlayback('playback.loaded', {
              ...requestState(),
              ...audioService.getPlaybackDiagnostics(result),
              shouldPlay
            });
            return true;
          } else {
            playbackRequestManager.failRequest(requestId);
            return false;
          }
        } catch (error) {
          logPlayback('playback.failed', {
            ...requestState(),
            stage: 'play',
            ...playbackErrorFields(error)
          });
          console.error('自动播放音频失败:', error);
          failPlayback('audio', requestId);
          playbackRequestManager.failRequest(requestId);
          return false;
        }
      } catch (error) {
        logPlayback('playback.failed', {
          ...requestState(),
          stage: 'source',
          ...playbackErrorFields(error)
        });
        console.error('处理播放音乐失败:', error);
        if (playbackRequestManager.isRequestValid(requestId)) {
          message.error(i18n.global.t('player.playbackRetry'));
          if (playMusic.value) playMusic.value.playLoading = false;
          failPlayback('source', requestId);
        }
        playbackRequestManager.failRequest(requestId);

        return false;
      }
    };

    /**
     * 播放音频
     */
    const playAudio = async (requestId?: string, recoveryPositionSeconds?: number) => {
      const playAudioStartedAt = performance.now();
      const attemptState = () => ({
        requestId,
        currentRequestId: playbackRequestManager.getCurrentRequestId(),
        selected: logTrack(playMusic.value),
        sourceKind: audioSourceKind(playMusicUrl.value),
        recoveryPositionSeconds,
        elapsedMs: Math.round(performance.now() - playAudioStartedAt)
      });
      if (!playMusicUrl.value || !playMusic.value) {
        logPlayback('playback.failed', { ...attemptState(), stage: 'missing-source' });
        if (!requestId || playbackRequestManager.isRequestValid(requestId)) {
          failPlayback('missing-source', requestId ?? playbackSession.value.requestId);
          if (playMusic.value) playMusic.value.playLoading = false;
          message.error(i18n.global.t('player.sourceUnavailable'));
        }
        return null;
      }

      // 如果提供了 requestId，验证请求是否仍然有效
      if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
        console.log(`[playAudio] 请求已失效: ${requestId}`);
        logPlayback('playback.superseded', { ...attemptState(), stage: 'before-preload' });
        return null;
      }

      try {
        const requestedTrack = { ...playMusic.value };
        const requestedUrl = playMusicUrl.value;

        // 自动恢复优先使用出错时的实际进度，普通启动才读取保存的进度。
        let savedProgress: { songId?: SongResult['id']; progress?: number } | null = null;
        try {
          savedProgress = JSON.parse(localStorage.getItem('playProgress') || '{}');
        } catch {
          logPlayback('playback.saved-progress-invalid', { ...attemptState() });
        }
        console.log(
          '[playAudio] 读取保存的进度:',
          savedProgress,
          '当前歌曲ID:',
          playMusic.value.id
        );
        const savedProgressMatched = savedProgress?.songId === playMusic.value.id;
        const resumePosition = chooseResumePosition(
          requestedTrack.id,
          recoveryPositionSeconds,
          savedProgress
        );
        const initialPosition = resumePosition.seconds;

        // 使用 PreloadService 获取音频
        // 优先使用已预加载的 sound（通过 consume 获取并从缓存中移除）
        // 如果没有预加载，则进行加载
        let sound: Howl;
        const preloadTrack = logTrack(requestedTrack);
        const preloadStartedAt = performance.now();
        try {
          // 先尝试消耗预加载的 sound
          const preloadedSound = preloadService.consume(requestedTrack);
          logPlayback('playback.preload', {
            ...attemptState(),
            requested: preloadTrack,
            shouldPlay: play.value,
            positionSeconds: initialPosition,
            positionSource: resumePosition.source,
            savedProgressMatched,
            cacheHit: preloadedSound?.state() === 'loaded'
          });
          if (preloadedSound && preloadedSound.state() === 'loaded') {
            console.log(`[playAudio] 使用预加载的音频: ${playMusic.value.name}`);
            sound = preloadedSound;
          } else {
            // 没有预加载或预加载状态不正常，需要加载
            console.log(`[playAudio] 没有预加载，开始加载: ${playMusic.value.name}`);
            bindPlaybackMedia(requestId, undefined, requestedUrl);
            sound = await preloadService.load(requestedTrack);
          }
        } catch (error) {
          logPlayback('playback.preload-failed', {
            ...attemptState(),
            requested: preloadTrack,
            preloadMs: Math.round(performance.now() - preloadStartedAt),
            ...playbackErrorFields(error)
          });
          console.error('PreloadService 加载失败:', error);
          // 如果 PreloadService 失败，尝试直接播放作为回退
          // 但通常 PreloadService 失败意味着 URL 问题
          throw error;
        }

        // 预加载期间可能已换歌。验证后才允许把音频交给播放器。
        if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
          logPlayback('playback.superseded', { ...attemptState(), stage: 'after-preload' });
          return null;
        }
        preloadService.consume(requestedTrack);
        const shouldPlay = play.value;
        // 播放新音频，传入已加载的 sound 实例
        logPlayback('playback.handoff', {
          ...attemptState(),
          requested: preloadTrack,
          loadedTrack: preloadService.getLoadedTrack(sound),
          positionSeconds: Number.isFinite(initialPosition) ? initialPosition : undefined,
          preloadMs: Math.round(performance.now() - preloadStartedAt)
        });
        const newSound = await audioService.play(
          requestedUrl,
          requestedTrack,
          shouldPlay,
          initialPosition || 0,
          sound,
          requestId,
          () => play.value && (!requestId || playbackRequestManager.isRequestValid(requestId))
        );

        // 播放后再次验证请求
        if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
          console.log(`[playAudio] 播放后请求已失效: ${requestId}`);
          logPlayback('playback.superseded', {
            ...attemptState(),
            ...audioService.getPlaybackDiagnostics(newSound),
            stage: 'after-audio-load'
          });
          newSound.stop();
          newSound.unload();
          return null;
        }

        // 添加播放状态检测
        if (shouldPlay && requestId) {
          checkPlaybackState(playMusic.value, requestId);
        }
        updatePlayback({ type: 'ready', requestId: requestId ?? playbackSession.value.requestId });
        if (audioService.isActuallyPlaying()) onAudioPlaying();

        // 发布音频就绪事件
        window.dispatchEvent(
          new CustomEvent('audio-ready', { detail: { sound: newSound, shouldPlay } })
        );

        // 时长检查已在 preloadService.ts 中完成

        return newSound;
      } catch (error) {
        logPlayback('playback.failed', {
          ...attemptState(),
          stage: 'audio',
          ...playbackErrorFields(error)
        });
        console.error('播放音频失败:', error);

        const errorMsg = error instanceof Error ? error.message : String(error);

        if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
          logPlayback('playback.retry-skipped', {
            ...attemptState(),
            reason: 'superseded',
            stage: 'audio-error'
          });
          return null;
        }

        // 操作锁错误不应该停止播放状态，只需要重试
        if (errorMsg.includes('操作锁激活')) {
          console.log('由于操作锁正在使用，将在1000ms后重试');
          logPlayback('playback.retry-scheduled', {
            ...attemptState(),
            reason: 'operation-lock',
            delayMs: 1000
          });

          try {
            audioService.forceResetOperationLock();
            console.log('已强制重置操作锁');
          } catch (e) {
            console.error('重置操作锁失败:', e);
          }

          setTimeout(() => {
            // 验证请求是否仍然有效再重试
            if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
              console.log('重试时请求已失效，跳过重试');
              logPlayback('playback.retry-skipped', {
                ...attemptState(),
                reason: 'operation-lock',
                stage: 'superseded'
              });
              return;
            }
            if (play.value) {
              logPlayback('playback.retry', { ...attemptState(), reason: 'operation-lock' });
              playAudio(requestId, recoveryPositionSeconds).catch((e) => {
                console.error('重试播放失败:', e);
                setPlayMusic(false);
              });
            }
          }, 1000);
        } else {
          // 非操作锁错误，停止播放并通知用户
          failPlayback('audio', requestId ?? playbackSession.value.requestId);
          console.warn('播放音频失败（非操作锁错误），由调用方处理重试');
          message.error(i18n.global.t('player.playbackRetry'));
        }

        return null;
      }
    };

    /**
     * 暂停播放
     */
    const handlePause = async () => {
      try {
        const currentSound = audioService.getCurrentSound();
        if (currentSound) {
          currentSound.pause();
        }
        setPlayMusic(false);
      } catch (error) {
        console.error('暂停播放失败:', error);
      }
    };

    /**
     * 设置播放/暂停
     */
    const setPlayMusic = async (value: boolean | SongResult) => {
      if (typeof value === 'boolean') {
        setIsPlay(value);
      } else {
        await handlePlayMusic(value);
      }
    };

    /**
     * 使用指定音源重新解析当前歌曲
     */
    const reparseCurrentSong = async (sourcePlatform: Platform, isAuto: boolean = false) => {
      try {
        const currentSong = playMusic.value;
        if (!currentSong || !currentSong.id) {
          console.warn('没有有效的播放对象');
          return false;
        }
        logPlayback('playback.reparse', {
          selected: logTrack(currentSong),
          source: sourcePlatform,
          automatic: isAuto
        });

        // 使用 SongSourceConfigManager 保存配置
        SongSourceConfigManager.setConfig(
          currentSong.id,
          [sourcePlatform],
          isAuto ? 'auto' : 'manual'
        );

        const currentSound = audioService.getCurrentSound();
        if (currentSound) {
          currentSound.pause();
        }

        const numericId =
          typeof currentSong.id === 'string' ? parseInt(currentSong.id, 10) : currentSong.id;

        console.log(`使用音源 ${sourcePlatform} 重新解析歌曲 ${numericId}`);

        const songData = cloneDeep(currentSong);
        const res = await getParsingMusicUrl(numericId, songData);

        if (res && res.data && res.data.data && res.data.data.url) {
          const newUrl = res.data.data.url;
          console.log(`解析成功，获取新URL: ${newUrl.substring(0, 50)}...`);

          const updatedMusic = {
            ...currentSong,
            playMusicUrl: newUrl,
            expiredAt: Date.now() + 1800000
          };

          await handlePlayMusic(updatedMusic, true);

          // 更新播放列表中的歌曲信息
          const { usePlaylistStore } = await import('./playlist');
          const playlistStore = usePlaylistStore();
          playlistStore.updateSong(updatedMusic);

          return true;
        } else {
          console.warn(`使用音源 ${sourcePlatform} 解析失败`);
          return false;
        }
      } catch (error) {
        console.error('重新解析失败:', error);
        return false;
      }
    };

    /**
     * 初始化播放状态
     */
    const initializePlayState = async () => {
      if (playbackRequestManager.getCurrentRequestId()) {
        logPlayback('startup.restore-skipped', { reason: 'user-request-already-started' });
        return;
      }
      const { useSettingsStore } = await import('./settings');
      const settingStore = useSettingsStore();
      const savedTrack = logTrack(playMusic.value);
      const startedAt = performance.now();
      let requestId: string | null = null;
      logPlayback('startup.restore', {
        savedTrack,
        autoPlay: settingStore.setData.autoPlay,
        online: navigator.onLine,
        lxSourceConfigured: Boolean(settingStore.setData.activeLxMusicApiId),
        sourceKind: audioSourceKind(playMusic.value?.playMusicUrl)
      });

      if (playMusic.value && Object.keys(playMusic.value).length > 0) {
        try {
          console.log('恢复上次播放的音乐:', playMusic.value.name);
          const isPlaying = settingStore.setData.autoPlay;

          // 本地音乐（local:// 协议）不需要重新获取 URL，保留原始路径
          const isLocalMusic = playMusic.value.playMusicUrl?.startsWith('local://');

          const pendingRestore = handlePlayMusic(
            {
              ...playMusic.value,
              isFirstPlay: true,
              playMusicUrl: isLocalMusic ? playMusic.value.playMusicUrl : undefined
            },
            isPlaying,
            'startup'
          );
          requestId = playbackRequestManager.getCurrentRequestId();
          const loaded = await pendingRestore;
          const audio = audioService.getPlaybackDiagnostics();
          logPlayback('startup.restore-result', {
            ...audio,
            requestId,
            currentRequestId: playbackRequestManager.getCurrentRequestId(),
            savedTrack,
            loaded,
            shouldPlay: isPlaying,
            elapsedMs: Math.round(performance.now() - startedAt)
          });
        } catch (error) {
          logPlayback('startup.restore-failed', {
            requestId,
            savedTrack,
            elapsedMs: Math.round(performance.now() - startedAt),
            ...playbackErrorFields(error)
          });
          console.error('重新获取音乐链接失败:', error);
          setIsPlay(false);
          playMusic.value = {} as SongResult;
          playMusicUrl.value = '';
        }
      } else {
        logPlayback('startup.restore-skipped', { reason: 'empty-saved-track' });
      }

      setTimeout(() => {
        audioService.setPlaybackRate(playbackRate.value);
      }, 2000);
    };

    // ==================== 音频输出设备管理 ====================

    /**
     * 刷新可用音频输出设备列表
     */
    const refreshAudioDevices = async () => {
      availableAudioDevices.value = await audioService.getAudioOutputDevices();
    };

    /**
     * 切换音频输出设备
     */
    const setAudioOutputDevice = async (deviceId: string): Promise<boolean> => {
      const success = await audioService.setAudioOutputDevice(deviceId);
      if (success) {
        audioOutputDeviceId.value = deviceId;
      }
      return success;
    };

    /**
     * 初始化设备变化监听
     */
    const initAudioDeviceListener = () => {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.addEventListener('devicechange', async () => {
          await refreshAudioDevices();
          const exists = availableAudioDevices.value.some(
            (d) => d.deviceId === audioOutputDeviceId.value
          );
          if (!exists && audioOutputDeviceId.value !== 'default') {
            await setAudioOutputDevice('default');
          }
        });
      }
    };

    return {
      // 状态
      play,
      isPlay,
      playMusic,
      playMusicUrl,
      musicFull,
      playbackRate,
      volume,
      userPlayIntent,
      failedTrackId,
      playbackStatus,
      isFmPlaying,
      audioOutputDeviceId,
      availableAudioDevices,

      // Computed
      currentSong,
      isPlaying,

      // Actions
      setIsPlay,
      onAudioPlaying,
      onAudioPaused,
      setMusicFull,
      setPlayMusic,
      setPlaybackRate,
      setVolume,
      getVolume,
      increaseVolume,
      decreaseVolume,
      handlePlayMusic,
      playAudio,
      handlePause,
      checkPlaybackState,
      reparseCurrentSong,
      initializePlayState,
      refreshAudioDevices,
      setAudioOutputDevice,
      initAudioDeviceListener
    };
  },
  {
    persist: {
      key: 'player-core-store',
      storage: localStorage,
      pick: ['playMusic', 'playMusicUrl', 'playbackRate', 'volume', 'audioOutputDeviceId']
    }
  }
);
