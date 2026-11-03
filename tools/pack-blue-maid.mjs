/**
 * Technical sprite packaging: extract existing drawings, use ONE uniform scale
 * per action, align the declared foot/head anchor, preserve alpha, encode WebM.
 * No new poses, interpolation, cross-fades, or retouching are generated here.
 * Run from any directory: node tools/pack-blue-maid.mjs [--encode]
 * Configure inputs/timing in character-source/pack-plan.json.
 * SHARP_MODULE_PATH and FFMPEG_PATH may point to existing local dependencies.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); }
catch { if (!process.env.SHARP_MODULE_PATH) throw new Error('Asset rebuilding requires sharp: npm install --no-save sharp@0.35.5, or set SHARP_MODULE_PATH.'); sharp = require(process.env.SHARP_MODULE_PATH); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'character-source');
const plan = JSON.parse(await fs.readFile(path.join(sourceRoot, 'pack-plan.json'), 'utf8'));
const shouldEncode = process.argv.includes('--encode');
const threshold = 64, canvasSize = plan.canvas.size, baseline = plan.canvas.baseline;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(path.join(sourceRoot, 'audits'), { recursive: true });
const manifest = { schemaVersion: 1, character: '蓝发女仆', canvas: plan.canvas, technicalOperations: ['crop', 'one uniform scale per action', 'foot-anchor translation', 'alpha-preserving PNG export', 'optional alpha WebM encoding'], generatedIntermediatePoses: false, crossfadeFrames: false, groups: {} };

function alphaBounds(buffer, w, h, y0 = 0, y1 = h) {
  let left = w, right = -1, top = h, bottom = -1, pixels = 0, sx = 0, sy = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    if (buffer[(y * w + x) * 4 + 3] <= threshold) continue;
    pixels++; sx += x; sy += y; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, pixels, centroidX: pixels ? sx / pixels : null, centroidY: pixels ? sy / pixels : null };
}

function components(raw, w, h) {
  const marked = new Uint8Array(w * h), found = [];
  for (let p = 0; p < marked.length; p++) marked[p] = raw[p * 4 + 3] > threshold ? 1 : 0;
  for (let seed = 0; seed < marked.length; seed++) {
    if (marked[seed] !== 1) continue;
    const stack = [seed]; marked[seed] = 2;
    let pixels = 0, left = w, right = -1, top = h, bottom = -1;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = Math.floor(p / w);
      pixels++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      const candidates = [];
      if (x > 0) candidates.push(p - 1); if (x + 1 < w) candidates.push(p + 1);
      if (y > 0) candidates.push(p - w); if (y + 1 < h) candidates.push(p + w);
      for (const q of candidates) if (marked[q] === 1) { marked[q] = 2; stack.push(q); }
    }
    if (pixels > 1000) found.push({ left, right, top, bottom, width: right - left + 1, height: bottom - top + 1, pixels });
  }
  return found.sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom) || a.left - b.left);
}

function silhouetteDifference(a, b) {
  let intersection = 0, union = 0, absolute = 0;
  for (let p = 0; p < canvasSize * canvasSize; p++) {
    const q = p * 4, aa = a[q + 3] > threshold, bb = b[q + 3] > threshold;
    if (aa || bb) { union++; for (let c = 0; c < 3; c++) absolute += Math.abs(a[q + c] - b[q + c]); }
    if (aa && bb) intersection++;
  }
  return { alphaSilhouetteIoU: intersection / union, rgbMeanAbsoluteDifferenceOverUnion: absolute / (union * 3) };
}

for (const spec of plan.groups) {
  const rawFile = path.resolve(sourceRoot, spec.source);
  if (!rawFile.startsWith(sourceRoot + path.sep)) throw new Error('Source must be inside character-source.');
  const bytes = await fs.readFile(rawFile), rawHash = hash(bytes);
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = decoded.info.width, h = decoded.info.height;
  const found = components(decoded.data, w, h);
  if (found.length !== spec.rows * spec.columns) throw new Error(`${spec.id}: found ${found.length} main foreground components, expected ${spec.rows * spec.columns}; reinspect the source.`);
  const rows = Array.from({ length: spec.rows }, (_, row) => found.slice(row * spec.columns, (row + 1) * spec.columns).sort((a, b) => a.left - b.left));
  const ordered = rows.flat();
  const touchedSourceEdges = ordered.map((c, i) => ({ frame: i + 1, edges: [c.left === 0 && 'left', c.right === w - 1 && 'right', c.top === 0 && 'top', c.bottom === h - 1 && 'bottom'].filter(Boolean) })).filter(a => a.edges.length);
  if (touchedSourceEdges.length && !spec.allowSourceEdge) throw new Error(`${spec.id}: visible characters touch original sheet edge: ${JSON.stringify(touchedSourceEdges)}. A padded repaired source is required; do not invent missing pixels in code.`);
  const sortedHeights = ordered.map(c => c.height).sort((a, b) => a - b);
  const medianHeight = (sortedHeights[Math.floor((sortedHeights.length - 1) / 2)] + sortedHeights[Math.ceil((sortedHeights.length - 1) / 2)]) / 2;
  const scale = spec.fixedScale || plan.canvas.referenceVisibleHeight / medianHeight;
  const frameDir = path.join(sourceRoot, 'frames', spec.id);
  await fs.mkdir(frameDir, { recursive: true });
  const frames = [], frameRaws = [], tiles = [], audits = [];
  for (let index = 0; index < ordered.length; index++) {
    const c = ordered[index], row = Math.floor(index / spec.columns), col = index % spec.columns;
    const cellLeft = col === 0 ? 0 : Math.floor((rows[row][col - 1].right + c.left + 1) / 2);
    const cellRight = col === spec.columns - 1 ? w : Math.floor((c.right + rows[row][col + 1].left + 1) / 2);
    const cellTop = row === 0 ? 0 : Math.floor((Math.max(...rows[row - 1].map(a => a.bottom)) + Math.min(...rows[row].map(a => a.top)) + 1) / 2);
    const cellBottom = row === spec.rows - 1 ? h : Math.floor((Math.max(...rows[row].map(a => a.bottom)) + Math.min(...rows[row + 1].map(a => a.top)) + 1) / 2);
    const cropLeft = Math.max(cellLeft, c.left - 4), cropRight = Math.min(cellRight, c.right + 5);
    const cropTop = Math.max(cellTop, c.top - 4), cropBottom = Math.min(cellBottom, c.bottom + 5);
    const crop = { left: cropLeft, top: cropTop, width: cropRight - cropLeft, height: cropBottom - cropTop };
    const extracted = await sharp(bytes).extract(crop).ensureAlpha().raw().toBuffer();
    const footBand = alphaBounds(extracted, crop.width, crop.height, Math.max(0, c.bottom - crop.top - 17), c.bottom - crop.top + 1);
    const sourceFootAnchor = { x: footBand.centroidX, y: c.bottom - crop.top };
    const headBand = spec.anchor === 'head' ? alphaBounds(extracted, crop.width, crop.height, c.top - crop.top, Math.min(crop.height, c.top - crop.top + spec.headBandHeight)) : null;
    const sourceAnchor = headBand ? { x: headBand.centroidX, y: headBand.centroidY } : sourceFootAnchor;
    // Supplying height only preserves the aspect ratio (integer output rounding).
    const resizedResult = await sharp(extracted, { raw: { width: crop.width, height: crop.height, channels: 4 } }).resize({ height: Math.round(crop.height * scale), kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rw = resizedResult.info.width, rh = resizedResult.info.height, resized = resizedResult.data;
    const actualScaleX = rw / crop.width, actualScaleY = rh / crop.height;
    const core = alphaBounds(resized, rw, rh);
    const left = Math.round((headBand ? spec.anchorTarget.x : canvasSize / 2) - sourceAnchor.x * actualScaleX);
    const top = headBand ? Math.round(spec.anchorTarget.y - sourceAnchor.y * actualScaleY) : baseline - core.bottom;
    if (left < 0 || top < 0 || left + rw > canvasSize || top + rh > canvasSize) throw new Error(`${spec.id}-${index + 1}: output would cross canvas boundary; reduce the group fixedScale.`);
    const file = `frame-${String(index + 1).padStart(2, '0')}.png`, dest = path.join(frameDir, file);
    await sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: resized, raw: { width: rw, height: rh, channels: 4 }, left, top }]).png().toFile(dest);
    const output = await sharp(dest).ensureAlpha().raw().toBuffer();
    const visible = alphaBounds(output, canvasSize, canvasSize);
    if (visible.left <= 0 || visible.top <= 0 || visible.right >= canvasSize - 1 || visible.bottom >= canvasSize - 1 || (!headBand && visible.bottom !== baseline)) throw new Error(`${spec.id}-${index + 1}: failed visible-boundary/anchor check.`);
    const durationMs = spec.timesMs[index];
    if (!Number.isInteger(durationMs) || durationMs < 20 || durationMs % 20) throw new Error('Frame durations must be positive multiples of 20ms for the 50fps WebM timeline.');
    frames.push({ file: `character-source/frames/${spec.id}/${file}`, durationMs }); frameRaws.push(output);
    audits.push({ index: index + 1, sourceMainComponent: c, crop, groupUniformScale: scale, anchorMode: headBand ? 'head' : 'feet', sourceAnchor, sourceFootAnchor, outputAnchor: { x: left + sourceAnchor.x * actualScaleX, y: top + sourceAnchor.y * actualScaleY }, actualScaleX, actualScaleY, destination: { left, top, width: rw, height: rh }, visibleBounds: visible, upperBand60to280: alphaBounds(output, canvasSize, canvasSize, 60, 280), lowerBand280to481: alphaBounds(output, canvasSize, canvasSize, 280, baseline + 1), sha256: hash(await fs.readFile(dest)) });
    tiles.push({ input: await sharp(dest).resize(256, 256).png().toBuffer(), left: col * 256, top: row * 256 });
  }
  const pairs = frames.map((f, i) => ({ from: i + 1, to: (i + 1) % frames.length + 1, loopSeam: i === frames.length - 1, ...silhouetteDifference(frameRaws[i], frameRaws[(i + 1) % frames.length]) }));
  const group = { id: spec.id, source: spec.source, sourceWidth: w, sourceHeight: h, sourceSha256: rawHash, genuineDrawings: frames.length, generatedIntermediatePoses: false, crossfadeFrames: false, frames, output: spec.output, totalDurationMs: frames.reduce((n, f) => n + f.durationMs, 0), groupUniformScale: scale, neutralFrameCalibration: spec.calibration || null, anchor: spec.anchor === 'head' ? { mode: 'head', bandHeight: spec.headBandHeight, target: spec.anchorTarget } : { mode: 'feet', target: { x: canvasSize / 2, y: baseline } }, sourceEdgeWarnings: touchedSourceEdges, status: touchedSourceEdges.length ? 'diagnostic-source-edge-repair-required' : 'static-packaging-checked', loopAudit: pairs, auditFile: `character-source/audits/${spec.id}.json`, notes: ['Original RGB and alpha are preserved within technical crops; no threshold cleanup or retouching was applied.', 'One fixed uniform scale is shared by every drawing in this action; visible height is allowed to change naturally.', spec.anchor === 'head' ? 'The head-band alpha centroid stays fixed; feet can move naturally while suspended.' : 'Foot band alpha centroid and visible sole baseline define translation anchors.', 'Loop difference metrics are diagnostic and do not establish artistic approval.', '50fps video encoding repeats/holds these genuine drawings and does not create 50 unique poses per second.'] };
  await fs.writeFile(path.join(sourceRoot, 'audits', `${spec.id}.json`), JSON.stringify({ ...group, frameGeometry: audits }, null, 2) + '\n');
  for (const bg of [{ name: 'light', r: 239, g: 241, b: 245 }, { name: 'dark', r: 30, g: 34, b: 42 }]) await sharp({ create: { width: spec.columns * 256, height: spec.rows * 256, channels: 4, background: { r: bg.r, g: bg.g, b: bg.b, alpha: 1 } } }).composite(tiles).png().toFile(path.join(sourceRoot, 'audits', `${spec.id}-contact-${bg.name}.png`));
  if (shouldEncode) {
    if (touchedSourceEdges.length) throw new Error(`${spec.id}: do not encode a production video from an edge-clipped source.`);
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const outputFile = path.resolve(root, spec.output);
    if (!outputFile.startsWith(path.join(root, 'assets', 'animations') + path.sep)) throw new Error('Output must stay inside assets/animations.');
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    const concatFile = path.join(sourceRoot, 'audits', `${spec.id}-timeline.ffconcat`);
    const escapeConcat = s => s.replaceAll('\\', '/').replaceAll("'", "'\\''");
    let concat = 'ffconcat version 1.0\n';
    for (const f of frames) concat += `file '${escapeConcat(path.join(root, f.file))}'\noption framerate 50\nduration ${(f.durationMs / 1000).toFixed(3)}\n`;
    concat += `file '${escapeConcat(path.join(root, frames.at(-1).file))}'\noption framerate 50\n`;
    await fs.writeFile(concatFile, concat);
    // Explicit fps + a final held frame prevents an output -t cutoff from
    // dropping the final still's requested dwell time. These are repeats only.
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-an', '-vf', 'fps=50,tpad=stop_mode=clone:stop_duration=1', '-t', (group.totalDurationMs / 1000).toFixed(3), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '18', '-b:v', '0', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-metadata:s:v:0', 'alpha_mode=1', outputFile];
    const encoded = spawnSync(ffmpeg, args, { encoding: 'utf8', windowsHide: true });
    if (encoded.error || encoded.status !== 0) throw new Error(`ffmpeg encoding failed: ${encoded.error || encoded.stderr}`);
    const proofFile = path.join(sourceRoot, 'audits', `${spec.id}-decoded-first-frame.png`);
    const proof = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', outputFile, '-frames:v', '1', proofFile], { encoding: 'utf8', windowsHide: true });
    if (proof.error || proof.status !== 0) throw new Error(`WebM alpha decode check failed: ${proof.error || proof.stderr}`);
    const proofDecoded = await sharp(proofFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparentPixels = 0, foregroundPixels = 0;
    for (let p = 3; p < proofDecoded.data.length; p += 4) { if (!proofDecoded.data[p]) transparentPixels++; if (proofDecoded.data[p] > threshold) foregroundPixels++; }
    if (proofDecoded.info.width !== canvasSize || proofDecoded.info.height !== canvasSize || !transparentPixels || !foregroundPixels) throw new Error('Encoded video did not retain expected dimensions and transparent/foreground pixels.');
    const ffprobe = process.env.FFPROBE_PATH || (ffmpeg === 'ffmpeg' ? 'ffprobe' : path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'));
    const measured = spawnSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames:stream_tags=alpha_mode:format=duration,size', '-of', 'json', outputFile], { encoding: 'utf8', windowsHide: true });
    if (measured.error || measured.status !== 0) throw new Error(`ffprobe verification failed: ${measured.error || measured.stderr}`);
    const probe = JSON.parse(measured.stdout), actualFrames = Number(probe.streams[0].nb_read_frames), expectedFrames = group.totalDurationMs / 20;
    const durationMs = Math.round(Number(probe.format.duration) * 1000);
    if (actualFrames !== expectedFrames || durationMs !== group.totalDurationMs) throw new Error(`${spec.id}: video dwell-time check failed (${actualFrames}/${expectedFrames} frames; ${durationMs}/${group.totalDurationMs}ms).`);
    const encodedBytes = await fs.readFile(outputFile);
    group.video = { file: spec.output, codec: 'VP9 with alpha', fps: 50, encodedFramesIncludingHolds: actualFrames, durationMs, uniqueSourceDrawings: frames.length, intermediatePoseGeneration: false, bytes: encodedBytes.length, sha256: hash(encodedBytes), probe, alphaDecodeCheck: { decoder: 'libvpx-vp9', transparentPixels, foregroundPixels, width: canvasSize, height: canvasSize } };
    group.status = 'encoded-alpha-decode-checked';
  }
  await fs.writeFile(path.join(sourceRoot, 'audits', `${spec.id}.json`), JSON.stringify({ ...group, frameGeometry: audits }, null, 2) + '\n');
  manifest.groups[spec.id] = group;
  console.log(JSON.stringify({ id: spec.id, drawings: frames.length, scale, status: group.status, totalDurationMs: group.totalDurationMs, sourceEdgeWarnings: touchedSourceEdges, loopSeam: pairs.at(-1), video: group.video }, null, 2));
}
await fs.writeFile(path.join(sourceRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
