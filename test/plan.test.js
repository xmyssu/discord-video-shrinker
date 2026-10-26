import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MB, planEncode, retryScale } from '../plan.js';

const iphone = { width: 1080, height: 1920, hasAudio: true };

test('total bitrate fits under the limit', () => {
  for (const duration of [5, 30, 60, 180]) {
    const p = planEncode({ ...iphone, limitBytes: 10 * MB, duration });
    assert.ok(p.ok);
    const bytes = ((p.videoBitrate + p.audioBitrate) * duration) / 8;
    assert.ok(bytes < 10 * MB, `${duration}s -> ${bytes}`);
  }
});

test('lower bitrate means lower resolution and keeps aspect ratio', () => {
  const short = planEncode({ ...iphone, limitBytes: 10 * MB, duration: 10 });
  const long = planEncode({ ...iphone, limitBytes: 10 * MB, duration: 120 });
  assert.equal(short.width, 1080);
  assert.ok(long.width < short.width);
  assert.ok(Math.abs(long.height / long.width - 1920 / 1080) < 0.02);
  assert.equal(long.width % 2, 0);
  assert.equal(long.height % 2, 0);
});

test('never upscales', () => {
  const p = planEncode({ width: 640, height: 360, hasAudio: false, limitBytes: 50 * MB, duration: 10 });
  assert.deepEqual([p.width, p.height], [640, 360]);
  assert.equal(p.audioBitrate, 0);
});

test('reports max length when the video is too long', () => {
  const p = planEncode({ ...iphone, limitBytes: 10 * MB, duration: 3600 });
  assert.equal(p.ok, false);
  assert.ok(p.maxSeconds > 60 && p.maxSeconds < 3600);
});

test('retry scale shrinks the bitrate below the overshoot ratio', () => {
  assert.ok(retryScale(1, 10 * MB, 11 * MB) < 10 / 11);
});
