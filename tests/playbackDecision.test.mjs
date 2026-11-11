import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseResumePosition,
  isCurrentPlaybackAttempt,
  playbackSourceKey
} from '../src/renderer/services/playbackDecision.ts';
import {
  createPlaybackSession,
  reducePlaybackSession
} from '../src/renderer/services/playbackSession.ts';

test('loading is distinct from playing, and pause during loading prevents autoplay', () => {
  let state = reducePlaybackSession(createPlaybackSession(), {
    type: 'begin',
    requestId: 'one',
    wantsPlay: true
  });
  assert.equal(state.phase, 'loading');
  state = reducePlaybackSession(state, { type: 'intent', wantsPlay: false });
  state = reducePlaybackSession(state, { type: 'playing', requestId: 'one' });
  assert.notEqual(state.phase, 'playing');
  state = reducePlaybackSession(state, { type: 'ready', requestId: 'one' });
  assert.equal(state.phase, 'paused');
});

test('new requests and terminal failures ignore late media results', () => {
  let state = reducePlaybackSession(createPlaybackSession(), {
    type: 'begin',
    requestId: 'new',
    wantsPlay: true
  });
  assert.equal(reducePlaybackSession(state, { type: 'playing', requestId: 'old' }), state);
  assert.equal(
    reducePlaybackSession(state, { type: 'failed', requestId: 'old', failure: 'audio' }),
    state
  );
  state = reducePlaybackSession(state, { type: 'failed', requestId: 'new', failure: 'source' });
  assert.equal(state.wantsPlay, false);
  assert.equal(reducePlaybackSession(state, { type: 'ready', requestId: 'new' }), state);
  assert.equal(reducePlaybackSession(state, { type: 'playing', requestId: 'new' }), state);
});

test('preloading separates providers and refreshed URLs for the same song', () => {
  const song = { id: 1, source: 'netease', playMusicUrl: 'https://example.test/old' };
  assert.notEqual(
    playbackSourceKey(song),
    playbackSourceKey({ ...song, playMusicUrl: 'https://example.test/new' })
  );
  assert.notEqual(playbackSourceKey(song), playbackSourceKey({ ...song, source: 'other' }));
});

test('recovery uses the media position before an older saved position', () => {
  assert.deepEqual(chooseResumePosition(1, 8.25, { songId: 1, progress: 0 }), {
    seconds: 8.25,
    source: 'source-recovery'
  });
  assert.deepEqual(chooseResumePosition(1, undefined, { songId: 1, progress: 4 }), {
    seconds: 4,
    source: 'saved-progress'
  });
  assert.deepEqual(chooseResumePosition(1, undefined, { songId: 2, progress: 4 }), {
    seconds: 0,
    source: 'beginning'
  });
  assert.deepEqual(chooseResumePosition(1, Number.NaN, { songId: 1, progress: -1 }), {
    seconds: 0,
    source: 'beginning'
  });
});

test('late audio events cannot validate a different song or sound', () => {
  const oldSound = {};
  const currentSound = {};
  const base = {
    requestId: 'request-2',
    currentRequestId: 'request-2',
    selectedTrack: { id: 2, source: 'netease' },
    audioTrack: { id: 2, source: 'netease' },
    expectedSound: currentSound,
    currentSound
  };
  assert.equal(isCurrentPlaybackAttempt(base), true);
  assert.equal(isCurrentPlaybackAttempt({ ...base, expectedSound: oldSound }), false);
  assert.equal(isCurrentPlaybackAttempt({ ...base, requestId: 'request-1' }), false);
  assert.equal(isCurrentPlaybackAttempt({ ...base, audioTrack: { id: 1 } }), false);
  assert.equal(
    isCurrentPlaybackAttempt({ ...base, audioTrack: { id: 2, source: 'other' } }),
    false
  );
});
