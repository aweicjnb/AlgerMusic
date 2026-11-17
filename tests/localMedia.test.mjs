import assert from 'node:assert/strict';
import test from 'node:test';

import { playbackMediaUrl } from '../src/shared/localMedia.ts';

test('cached Windows local URLs become native file URLs without changing the filename', () => {
  const file = 'C:/Music/歌词 #1/回眸.mp3';
  const expected = 'file:///C:/Music/%E6%AD%8C%E8%AF%8D%20%231/%E5%9B%9E%E7%9C%B8.mp3';
  assert.equal(playbackMediaUrl(`local:///${encodeURIComponent(file)}`), expected);
  assert.equal(playbackMediaUrl('local://C:\\Music\\歌词 %231\\回眸.mp3'), expected);
});

test('escaped percent signs are decoded only once', () => {
  assert.equal(
    playbackMediaUrl('local:///C%3A%2FMusic%2F100%2525%23.mp3'),
    'file:///C:/Music/100%2525%23.mp3'
  );
});

test('POSIX and network-share local URLs keep their absolute location', () => {
  assert.equal(
    playbackMediaUrl('local:///%2Fhome%2Fmusic%2F%E6%AD%8C.mp3'),
    'file:///home/music/%E6%AD%8C.mp3'
  );
  assert.equal(
    playbackMediaUrl('local:///%2F%2Fserver%2Fshare%2F%E6%AD%8C.mp3'),
    'file://server/share/%E6%AD%8C.mp3'
  );
});

test('actual URI queries and fragments are removed independently from escaped filenames', () => {
  assert.equal(
    playbackMediaUrl('local:///C%3A%2FMusic%2F%231.mp3?x=1#fragment'),
    'file:///C:/Music/%231.mp3'
  );
});

test('network, native file and blob URLs retain their exact identity', () => {
  for (const url of [
    'https://example.test/music?a=1&signature=A%2Fb',
    'file:///C:/Music/a%20b.mp3',
    'blob:https://example.test/123'
  ]) {
    assert.equal(playbackMediaUrl(url), url);
  }
});

test('invalid local URLs cannot become relative file requests', () => {
  for (const url of ['local://relative.mp3', 'local:///%', 'local://'])
    assert.throws(() => playbackMediaUrl(url));
});
