import {
  Input, Output, Conversion, ConversionCanceledError, ALL_FORMATS, BlobSource, BufferTarget,
  Mp4OutputFormat, Quality, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
} from './vendor/mediabunny.min.mjs';
import { MB, planEncode, retryScale, formatBytes, formatDuration } from './plan.js';

const $ = (id) => document.getElementById(id);
const sections = ['pick-section', 'setup-section', 'progress-section', 'done-section'];
const MAX_ATTEMPTS = 3;

let file = null;          // The picked source file.
let info = null;          // { duration, width, height, hasAudio, fps } of the source.
let conversion = null;    // The running Conversion, for cancel.
let canceled = false;
let outputUrl = null;
let previewUrl = null;

function show(id) {
  for (const s of sections) $(s).hidden = s !== id;
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

// ---------- Settings ----------

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
}

function limitBytes() {
  const v = $('limit').value === 'custom' ? Number($('limit-custom').value) : Number($('limit').value);
  return v > 0 ? v * MB : 10 * MB;
}

function restoreSettings() {
  const limit = storageGet('limit');
  if (limit && [...$('limit').options].some((o) => o.value === limit)) $('limit').value = limit;
  $('limit-custom').value = storageGet('limitCustom') || '';
  $('limit-custom').hidden = $('limit').value !== 'custom';
}

$('limit').addEventListener('change', () => {
  storageSet('limit', $('limit').value);
  $('limit-custom').hidden = $('limit').value !== 'custom';
  updatePlan();
});
$('limit-custom').addEventListener('input', () => {
  storageSet('limitCustom', $('limit-custom').value);
  updatePlan();
});

// ---------- Picking a file ----------

$('file').addEventListener('change', () => {
  if ($('file').files[0]) loadFile($('file').files[0]);
});

const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

async function loadFile(f) {
  showError('');
  file = f;
  info = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(f);
  $('preview').src = previewUrl;
  $('file-meta').textContent = `${f.name} · ${formatBytes(f.size)} · reading…`;
  $('trim-start').value = 0;
  $('trim-end').value = '';
  $('convert').disabled = true;
  show('setup-section');

  const input = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("That file doesn't contain a video track.");
    const audio = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    const stats = await video.computePacketStats(120);
    info = {
      duration,
      width: video.displayWidth,
      height: video.displayHeight,
      hasAudio: !!audio,
      fps: stats.averagePacketRate,
    };
    $('trim-end').value = duration.toFixed(1);
    $('file-meta').textContent =
      `${f.name} · ${formatBytes(f.size)} · ${formatDuration(duration)} · ${info.width}×${info.height}`;
    $('convert').disabled = false;
    updatePlan();
  } catch (err) {
    console.error(err);
    showError(`Couldn't read this video: ${err.message}`);
    $('file-meta').textContent = `${f.name} · ${formatBytes(f.size)}`;
  } finally {
    input.dispose();
  }
}

// ---------- Trim ----------

function trimRange() {
  const start = Math.max(0, Number($('trim-start').value) || 0);
  let end = Number($('trim-end').value) || info.duration;
  end = Math.min(end, info.duration);
  return { start, end };
}

for (const btn of document.querySelectorAll('[data-set]')) {
  btn.addEventListener('click', () => {
    $(`trim-${btn.dataset.set}`).value = $('preview').currentTime.toFixed(1);
    updatePlan();
  });
}
$('trim-start').addEventListener('input', updatePlan);
$('trim-end').addEventListener('input', updatePlan);

function updatePlan() {
  if (!info) return;
  const { start, end } = trimRange();
  const duration = end - start;
  const limit = limitBytes();

  if (duration <= 0) {
    $('plan').textContent = 'The end of the trim must be after the start.';
    $('convert').disabled = true;
    return;
  }

  const untrimmed = start === 0 && end >= info.duration - 0.05;
  if (untrimmed && file.size <= limit) {
    $('plan').textContent = `This video is already under ${formatBytes(limit)}, so you can send it as-is.`;
    $('convert').disabled = false;
    return;
  }

  const plan = planEncode({ limitBytes: limit, duration, width: info.width, height: info.height, hasAudio: info.hasAudio });
  if (!plan.ok) {
    $('plan').textContent =
      `Too long to look decent in ${formatBytes(limit)}. Trim it to about ${formatDuration(plan.maxSeconds)} or less.`;
    $('convert').disabled = true;
    return;
  }
  $('plan').textContent =
    `Will output ~${plan.width}×${plan.height} at ${(plan.videoBitrate / 1e6).toFixed(2)} Mbps, ` +
    `${formatDuration(duration)} long, under ${formatBytes(limit)}.`;
  $('convert').disabled = false;
}

// ---------- Converting ----------

$('convert').addEventListener('click', run);
$('cancel').addEventListener('click', async () => {
  canceled = true;
  await conversion?.cancel();
});
$('reset').addEventListener('click', reset);
$('again').addEventListener('click', reset);

function reset() {
  showError('');
  $('file').value = '';
  $('preview').removeAttribute('src');
  $('output-preview').removeAttribute('src');
  file = info = null;
  show('pick-section');
}

function setProgress(fraction, text) {
  $('bar-fill').style.width = `${Math.round(fraction * 100)}%`;
  if (text) $('status').textContent = text;
}

async function run() {
  showError('');
  const limit = limitBytes();
  const { start, end } = trimRange();
  const untrimmed = start === 0 && end >= info.duration - 0.05;

  if (untrimmed && file.size <= limit) {
    finish(file, file.name);
    return;
  }

  canceled = false;
  show('progress-section');
  $('preview').pause();
  const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);

  try {
    let scale = 1;
    let result = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const label = attempt === 1 ? 'Shrinking' : `Still too big, retrying smaller (try ${attempt})`;
      result = await encode({ limit, start, end, scale, label });
      if (result.size <= limit) break;
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Couldn't get under ${formatBytes(limit)} (got ${formatBytes(result.size)}). Try trimming the video.`);
      }
      scale = retryScale(scale, limit, result.size);
    }
    const name = file.name.replace(/\.[^.]+$/, '') + '-discord.mp4';
    finish(new File([result], name, { type: 'video/mp4' }), name);
  } catch (err) {
    if (err instanceof ConversionCanceledError || canceled) {
      show('setup-section');
    } else {
      console.error(err);
      showError(err.message || String(err));
      show('setup-section');
    }
  } finally {
    conversion = null;
    wakeLock?.release().catch(() => {});
  }
}

async function encode({ limit, start, end, scale, label }) {
  const plan = planEncode({
    limitBytes: limit, duration: end - start, width: info.width, height: info.height, hasAudio: info.hasAudio, scale,
  });
  if (!plan.ok) throw new Error('This video is too long for that limit. Trim it first.');

  setProgress(0, `${label}…`);

  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc'], { width: plan.width, height: plan.height });
  if (!videoCodec) {
    throw new Error("Your browser can't encode video. Update to the latest Safari (iOS) or Chrome (Android) and try again.");
  }
  const audioCodec = info.hasAudio ? await getFirstEncodableAudioCodec(['aac', 'opus']) : null;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  try {
    conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start, end },
      video: {
        width: plan.width,
        height: plan.height,
        fit: 'contain',
        codec: videoCodec,
        quality: new Quality({ bitrate: plan.videoBitrate }),
        frameRate: info.fps > plan.maxFrameRate + 1 ? plan.maxFrameRate : undefined,
        forceTranscode: true,
      },
      audio: audioCodec
        ? { codec: audioCodec, quality: new Quality({ bitrate: plan.audioBitrate }), forceTranscode: true }
        : { discard: true },
      showWarnings: false,
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((t) => `${t.track?.type}: ${t.reason}`).join(', ');
      throw new Error(`This video can't be converted on this device (${reasons}).`);
    }

    conversion.onProgress = (p) => setProgress(p, `${label}… ${Math.round(p * 100)}%`);
    await conversion.execute();
    setProgress(1);
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}

// ---------- Result ----------

function finish(resultFile, name) {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = URL.createObjectURL(resultFile);
  $('output-preview').src = outputUrl;
  $('download').href = outputUrl;
  $('download').download = name;
  $('result').textContent = resultFile === file
    ? `Already small enough (${formatBytes(file.size)}).`
    : `Done: ${formatBytes(file.size)} → ${formatBytes(resultFile.size)}`;

  const shareData = { files: [resultFile] };
  const canShare = navigator.canShare?.(shareData);
  $('share').hidden = !canShare;
  $('share').onclick = () => navigator.share(shareData).catch((err) => {
    if (err.name !== 'AbortError') showError(`Sharing failed: ${err.message}. Use "Save video" instead.`);
  });
  show('done-section');
}

// ---------- Android share target & offline ----------

async function loadSharedFile() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('shared-files');
    const res = await cache.match('shared-video');
    if (!res) return;
    const blob = await res.blob();
    await cache.delete('shared-video');
    const name = decodeURIComponent(res.headers.get('x-file-name') || 'video.mp4');
    loadFile(new File([blob], name, { type: blob.type }));
  } catch (err) {
    console.error(err);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
}

restoreSettings();
loadSharedFile();
