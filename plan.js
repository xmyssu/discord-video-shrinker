// Pure functions that decide how to encode a video so it lands under a size limit.
// Kept free of browser APIs so they can be unit-tested with `node --test`.

export const MB = 1000 * 1000; // Use decimal MB so we never exceed the service's limit, whichever unit it uses.

// Leave headroom for container overhead and encoder bitrate overshoot.
const SAFETY = 0.92;
const MIN_VIDEO_BITRATE = 120_000;

// Short-side resolution to use for a given video bitrate (H.264).
const LADDER = [
  { minBitrate: 4_500_000, shortSide: 1080 },
  { minBitrate: 2_000_000, shortSide: 720 },
  { minBitrate: 1_000_000, shortSide: 540 },
  { minBitrate: 550_000, shortSide: 480 },
  { minBitrate: 0, shortSide: 360 },
];

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * @param {object} p
 * @param {number} p.limitBytes   Max output size in bytes.
 * @param {number} p.duration     Output duration in seconds (after trimming).
 * @param {number} p.width        Source display width.
 * @param {number} p.height       Source display height.
 * @param {boolean} p.hasAudio
 * @param {number} [p.scale=1]    Extra bitrate multiplier, used when retrying after an oversized result.
 */
export function planEncode({ limitBytes, duration, width, height, hasAudio, scale = 1 }) {
  if (!(duration > 0)) throw new Error('Could not read the video duration.');

  const totalBitrate = (limitBytes * 8 * SAFETY * scale) / duration;
  let audioBitrate = 0;
  if (hasAudio) audioBitrate = totalBitrate > 1_000_000 ? 128_000 : totalBitrate > 400_000 ? 96_000 : 64_000;
  const videoBitrate = Math.floor(totalBitrate - audioBitrate);

  if (videoBitrate < MIN_VIDEO_BITRATE) {
    const maxSeconds = Math.floor((limitBytes * 8 * SAFETY) / (MIN_VIDEO_BITRATE + audioBitrate));
    return { ok: false, maxSeconds };
  }

  const srcShort = Math.min(width, height);
  const targetShort = Math.min(srcShort, LADDER.find((s) => videoBitrate >= s.minBitrate).shortSide);
  const factor = targetShort / srcShort;

  return {
    ok: true,
    videoBitrate,
    audioBitrate,
    width: even(width * factor),
    height: even(height * factor),
    // High frame rates waste bits at low bitrates; 30 fps looks fine on Discord.
    maxFrameRate: videoBitrate < 3_000_000 ? 30 : 60,
  };
}

/** Scale factor for the next attempt when the encoder overshot the limit. */
export function retryScale(previousScale, limitBytes, actualBytes) {
  return previousScale * (limitBytes / actualBytes) * 0.95;
}

export function formatBytes(bytes) {
  if (bytes >= MB * 100) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

export function formatDuration(seconds) {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
