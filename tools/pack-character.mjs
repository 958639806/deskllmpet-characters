/**
 * Technical sprite packaging: extract existing drawings, use ONE uniform scale
 * per action, align the declared foot/head anchor, preserve alpha, encode WebM.
 * No new poses, interpolation, cross-fades, or retouching are generated here.
 * Run: node tools/pack-character.mjs --character <id> [--group idle] [--inspect] [--encode]
 * Inputs/timing: character-source/characters/<id>/pack-plan.json.
 * This tool never reads/writes the original blue-maid manifest or assets.
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
const option = name => { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1]; };
const characterId = option('--character');
const allowedIds = new Set(['blonde-reaper', 'orange-mage', 'violet-cat', 'white-dragon']);
if (!allowedIds.has(characterId)) throw new Error('Use --character blonde-reaper|orange-mage|violet-cat|white-dragon.');
const sourceRelative = `character-source/characters/${characterId}`;
const sourceRoot = path.join(root, 'character-source', 'characters', characterId);
const plan = JSON.parse(await fs.readFile(path.join(sourceRoot, 'pack-plan.json'), 'utf8'));
if (plan.character.id !== characterId) throw new Error('Plan character id does not match --character.');
const shouldEncode = process.argv.includes('--encode');
const inspectOnly = process.argv.includes('--inspect');
const onlyGroup = option('--group');
const threshold = 64, canvasSize = plan.canvas.size, baseline = plan.canvas.baseline;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (!inspectOnly) await fs.mkdir(path.join(sourceRoot, 'audits'), { recursive: true });
let previousManifest = { groups: {} };
try { previousManifest = JSON.parse(await fs.readFile(path.join(sourceRoot, 'manifest.json'), 'utf8')); } catch { }
const manifest = { schemaVersion: 2, character: plan.character, reference: plan.reference || null, canvas: plan.canvas, technicalOperations: ['crop', 'one uniform scale per action', 'declared foot/head-anchor translation', 'alpha-preserving PNG export', 'optional alpha WebM encoding'], generatedIntermediatePoses: false, crossfadeFrames: false, groups: previousManifest.groups || {} };
let processedGroups = 0;

function alphaBounds(buffer, w, h, y0 = 0, y1 = h, x0 = 0, x1 = w) {
  let left = w, right = -1, top = h, bottom = -1, pixels = 0, sx = 0, sy = 0;
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
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

function zeroProjectionRanges(raw, w, h) {
  const ys = new Uint32Array(h), xs = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (raw[(y * w + x) * 4 + 3] > threshold) { ys[y]++; xs[x]++; }
  const ranges = counts => {
    const result = []; let start = null;
    for (let i = 0; i <= counts.length; i++) {
      if (i < counts.length && counts[i] === 0) { if (start === null) start = i; }
      else if (start !== null) { result.push({ start, end: i - 1, length: i - start }); start = null; }
    }
    return result;
  };
  return { rows: ranges(ys), columns: ranges(xs) };
}

function checkedGridBounds(supplied, total, divisions, name, projectionRanges) {
  const internalGaps = projectionRanges.filter(r => r.start > 0 && r.end < total - 1 && r.length >= 4);
  const inferred = internalGaps.length === divisions - 1 ? [0, ...internalGaps.map(r => Math.floor((r.start + r.end + 1) / 2)), total] : null;
  const bounds = supplied || inferred || Array.from({ length: divisions + 1 }, (_, i) => Math.round(i * total / divisions));
  if (bounds.length !== divisions + 1 || bounds[0] !== 0 || bounds.at(-1) !== total || bounds.some((v, i) => !Number.isInteger(v) || (i && v <= bounds[i - 1]))) throw new Error(`Invalid ${name} grid bounds.`);
  return bounds;
}

function regionInCrop(region, cell, crop, cropWidth, cropHeight) {
  if (!region) return { x0: 0, x1: cropWidth, y0: 0, y1: cropHeight };
  const v = { x0: Math.floor(cell.left + region.left * cell.width - crop.left), x1: Math.ceil(cell.left + region.right * cell.width - crop.left), y0: Math.floor(cell.top + region.top * cell.height - crop.top), y1: Math.ceil(cell.top + region.bottom * cell.height - crop.top) };
  return { x0: Math.max(0, v.x0), x1: Math.min(cropWidth, v.x1), y0: Math.max(0, v.y0), y1: Math.min(cropHeight, v.y1) };
}

function neutralMetrics(raw, w, h, c, cell, spec) {
  const idle = plan.groups.find(g => g.id === 'idle');
  const headRegion = spec.calibration?.neutralHeadRegion || idle?.calibration?.neutralHeadRegion || { space: 'visible-bounds', left: .1, right: .9, top: 0, bottom: .6 };
  const worldRect = region => {
    const base = region?.space === 'visible-bounds' ? c : cell;
    return region ? { x0: Math.floor(base.left + region.left * base.width), x1: Math.ceil(base.left + region.right * base.width), y0: Math.floor(base.top + region.top * base.height), y1: Math.ceil(base.top + region.bottom * base.height) } : { x0: c.left, x1: c.right + 1, y0: c.top, y1: c.bottom + 1 };
  };
  const headRect = worldRect(headRegion), feetRect = worldRect(spec.footAnchorRegion || idle?.footAnchorRegion);
  const head = alphaBounds(raw, w, h, headRect.y0, headRect.y1, headRect.x0, headRect.x1);
  const feet = alphaBounds(raw, w, h, feetRect.y0, feetRect.y1, feetRect.x0, feetRect.x1);
  const shoeBand = alphaBounds(raw, w, h, Math.max(feetRect.y0, feet.bottom - (spec.footBandRows || 18) + 1), feet.bottom + 1, feetRect.x0, feetRect.x1);
  return { headRegion, head, shoeBand, footBaseline: feet.bottom, visible: c };
}

const plannedGroups = onlyGroup ? plan.groups.filter(g => g.id === onlyGroup) : plan.groups;
if (!plannedGroups.length) throw new Error(`Unknown action: ${onlyGroup}`);
for (const spec of plannedGroups) {
  const rawFile = path.resolve(sourceRoot, spec.source);
  if (!rawFile.startsWith(sourceRoot + path.sep)) throw new Error('Source must be inside character-source.');
  try { await fs.access(rawFile); } catch { console.log(JSON.stringify({ character: characterId, group: spec.id, status: 'pending-source', expectedSource: spec.source })); continue; }
  if (!inspectOnly && !spec.ready) { console.log(JSON.stringify({ character: characterId, group: spec.id, status: 'pending-bbox-and-scale-calibration', source: spec.source })); continue; }
  const bytes = await fs.readFile(rawFile), rawHash = hash(bytes);
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = decoded.info.width, h = decoded.info.height;
  const found = components(decoded.data, w, h);
  if (spec.rows * spec.columns !== 12 || spec.timesMs.length !== 12) throw new Error('Every action must declare twelve genuine source cells and twelve durations.');
  const zeroProjection = zeroProjectionRanges(decoded.data, w, h);
  const columnBounds = checkedGridBounds(spec.grid?.columnBounds, w, spec.columns, 'column', zeroProjection.columns);
  const rowBounds = checkedGridBounds(spec.grid?.rowBounds, h, spec.rows, 'row', zeroProjection.rows);
  const cells = [], ordered = [];
  for (let row = 0; row < spec.rows; row++) for (let col = 0; col < spec.columns; col++) {
    const cell = { left: columnBounds[col], top: rowBounds[row], width: columnBounds[col + 1] - columnBounds[col], height: rowBounds[row + 1] - rowBounds[row] };
    const cellRaw = await sharp(bytes).extract(cell).ensureAlpha().raw().toBuffer();
    const core = alphaBounds(cellRaw, cell.width, cell.height);
    if (!core.pixels) throw new Error(`${spec.id}: empty source cell ${cells.length + 1}; inspect the grid.`);
    ordered.push({ ...core, left: cell.left + core.left, right: cell.left + core.right, top: cell.top + core.top, bottom: cell.top + core.bottom }); cells.push(cell);
  }
  const touchedSourceEdges = ordered.map((c, i) => ({ frame: i + 1, edges: [c.left === 0 && 'left', c.right === w - 1 && 'right', c.top === 0 && 'top', c.bottom === h - 1 && 'bottom'].filter(Boolean) })).filter(a => a.edges.length);
  const touchedCellEdges = ordered.map((c, i) => ({ frame: i + 1, edges: [c.left === cells[i].left && 'left', c.right === cells[i].left + cells[i].width - 1 && 'right', c.top === cells[i].top && 'top', c.bottom === cells[i].top + cells[i].height - 1 && 'bottom'].filter(Boolean) })).filter(a => a.edges.length);
  const analysis = { character: characterId, group: spec.id, width: w, height: h, sourceSha256: rawHash, foregroundComponentsOver1000Pixels: found, columnBounds, rowBounds, zeroAlpha64ProjectionRanges: zeroProjection, neutral: neutralMetrics(decoded.data, w, h, ordered[0], cells[0], spec), frames: ordered.map((c, i) => ({ frame: i + 1, cell: cells[i], visibleBounds: c })), touchedSourceEdges, touchedCellEdges };
  if (inspectOnly) { console.log(JSON.stringify(analysis, null, 2)); continue; }
  if (touchedSourceEdges.length && !spec.allowSourceEdge) throw new Error(`${spec.id}: visible characters touch original sheet edge: ${JSON.stringify(touchedSourceEdges)}. A padded repaired source is required; do not invent missing pixels in code.`);
  if (touchedCellEdges.length) throw new Error(`${spec.id}: visible pixels touch a cutting boundary: ${JSON.stringify(touchedCellEdges)}. Reinspect row/column projections before slicing.`);
  const scale = spec.fixedScale;
  if (!(scale > 0 && Number.isFinite(scale))) throw new Error(`${spec.id}: set one inspected fixedScale for the complete action before packing.`);
  if (spec.anchor === 'head' && (!spec.anchorTarget || !(spec.headBandHeight > 0 || spec.headAnchorRegion))) throw new Error(`${spec.id}: calibrate a head anchor and target before packing.`);
  const frameDir = path.join(sourceRoot, 'frames', spec.id);
  await fs.mkdir(frameDir, { recursive: true });
  const frames = [], frameRaws = [], tiles = [], audits = [];
  for (let index = 0; index < ordered.length; index++) {
    const c = ordered[index], row = Math.floor(index / spec.columns), col = index % spec.columns;
    const cell = cells[index], cellLeft = cell.left, cellRight = cell.left + cell.width, cellTop = cell.top, cellBottom = cell.top + cell.height;
    const cropLeft = Math.max(cellLeft, c.left - 4), cropRight = Math.min(cellRight, c.right + 5);
    const cropTop = Math.max(cellTop, c.top - 4), cropBottom = Math.min(cellBottom, c.bottom + 5);
    const crop = { left: cropLeft, top: cropTop, width: cropRight - cropLeft, height: cropBottom - cropTop };
    const extracted = await sharp(bytes).extract(crop).ensureAlpha().raw().toBuffer();
    const visibleRegionBase = { left: c.left, top: c.top, width: c.width, height: c.height };
    const footRegion = regionInCrop(spec.footAnchorRegion, spec.footAnchorRegion?.space === 'visible-bounds' ? visibleRegionBase : cell, crop, crop.width, crop.height);
    const footVisible = alphaBounds(extracted, crop.width, crop.height, footRegion.y0, footRegion.y1, footRegion.x0, footRegion.x1);
    if (!footVisible.pixels) throw new Error(`${spec.id}-${index + 1}: foot anchor region is empty.`);
    const footBand = alphaBounds(extracted, crop.width, crop.height, Math.max(footRegion.y0, footVisible.bottom - (spec.footBandRows || 18) + 1), footVisible.bottom + 1, footRegion.x0, footRegion.x1);
    const sourceFootAnchor = { x: footBand.centroidX, y: footVisible.bottom };
    const headRegion = spec.headAnchorRegion ? regionInCrop(spec.headAnchorRegion, spec.headAnchorRegion.space === 'visible-bounds' ? visibleRegionBase : cell, crop, crop.width, crop.height) : { x0: 0, x1: crop.width, y0: c.top - crop.top, y1: Math.min(crop.height, c.top - crop.top + spec.headBandHeight) };
    const headBand = spec.anchor === 'head' ? alphaBounds(extracted, crop.width, crop.height, headRegion.y0, headRegion.y1, headRegion.x0, headRegion.x1) : null;
    if (headBand && !headBand.pixels) throw new Error(`${spec.id}-${index + 1}: head anchor region is empty.`);
    const sourceAnchor = headBand ? { x: headBand.centroidX, y: headBand.centroidY } : sourceFootAnchor;
    // Supplying height only preserves the aspect ratio (integer output rounding).
    const resizedResult = await sharp(extracted, { raw: { width: crop.width, height: crop.height, channels: 4 } }).resize({ height: Math.round(crop.height * scale), kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rw = resizedResult.info.width, rh = resizedResult.info.height, resized = resizedResult.data;
    const actualScaleX = rw / crop.width, actualScaleY = rh / crop.height;
    const resizedFootVisible = alphaBounds(resized, rw, rh, Math.floor(footRegion.y0 * actualScaleY), Math.ceil(footRegion.y1 * actualScaleY), Math.floor(footRegion.x0 * actualScaleX), Math.ceil(footRegion.x1 * actualScaleX));
    const left = Math.round((headBand ? spec.anchorTarget.x : canvasSize / 2) - sourceAnchor.x * actualScaleX);
    const footBaseline = spec.baseline ?? baseline;
    const top = headBand ? Math.round(spec.anchorTarget.y - sourceAnchor.y * actualScaleY) : footBaseline - resizedFootVisible.bottom;
    if (left < 0 || top < 0 || left + rw > canvasSize || top + rh > canvasSize) throw new Error(`${spec.id}-${index + 1}: output would cross canvas boundary; reduce the group fixedScale.`);
    const file = `frame-${String(index + 1).padStart(2, '0')}.png`, dest = path.join(frameDir, file);
    await sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: resized, raw: { width: rw, height: rh, channels: 4 }, left, top }]).png().toFile(dest);
    const output = await sharp(dest).ensureAlpha().raw().toBuffer();
    const visible = alphaBounds(output, canvasSize, canvasSize);
    if (visible.left <= 0 || visible.top <= 0 || visible.right >= canvasSize - 1 || visible.bottom >= canvasSize - 1) throw new Error(`${spec.id}-${index + 1}: failed visible-boundary/anchor check.`);
    const durationMs = spec.timesMs[index];
    if (!Number.isInteger(durationMs) || durationMs < 20 || durationMs % 20) throw new Error('Frame durations must be positive multiples of 20ms for the 50fps WebM timeline.');
    frames.push({ file: `${sourceRelative}/frames/${spec.id}/${file}`, durationMs }); frameRaws.push(output);
    audits.push({ index: index + 1, sourceVisibleBounds: c, sourceCell: cell, crop, groupUniformScale: scale, anchorMode: headBand ? 'head' : 'feet', sourceAnchor, sourceFootAnchor, outputAnchor: { x: left + sourceAnchor.x * actualScaleX, y: headBand ? top + sourceAnchor.y * actualScaleY : top + resizedFootVisible.bottom }, actualScaleX, actualScaleY, destination: { left, top, width: rw, height: rh }, visibleBounds: visible, upperBand60to280: alphaBounds(output, canvasSize, canvasSize, 60, 280), lowerBand280to481: alphaBounds(output, canvasSize, canvasSize, 280, baseline + 1), sha256: hash(await fs.readFile(dest)) });
    tiles.push({ input: await sharp(dest).resize(256, 256).png().toBuffer(), left: col * 256, top: row * 256 });
  }
  const pairs = frames.map((f, i) => ({ from: i + 1, to: (i + 1) % frames.length + 1, loopSeam: i === frames.length - 1, ...silhouetteDifference(frameRaws[i], frameRaws[(i + 1) % frames.length]) }));
  const group = {
    id: spec.id, source: spec.source, sourceWidth: w, sourceHeight: h, sourceSha256: rawHash,
    genuineDrawings: frames.length, distinctPackedFrameHashes: new Set(audits.map(a => a.sha256)).size,
    generatedIntermediatePoses: false, crossfadeFrames: false, frames, output: spec.output,
    totalDurationMs: frames.reduce((n, f) => n + f.durationMs, 0), groupUniformScale: scale,
    neutralFrameCalibration: spec.calibration || null,
    anchor: spec.anchor === 'head'
      ? { mode: 'head', bandHeight: spec.headBandHeight, region: spec.headAnchorRegion, target: spec.anchorTarget }
      : { mode: 'feet', region: spec.footAnchorRegion, target: { x: canvasSize / 2, y: spec.baseline ?? baseline } },
    sourceEdgeWarnings: touchedSourceEdges, cellEdgeWarnings: touchedCellEdges,
    status: touchedSourceEdges.length ? 'diagnostic-source-edge-repair-required' : 'static-packaging-checked',
    loopAudit: pairs, auditFile: `${sourceRelative}/audits/${spec.id}.json`, sourceAnalysis: analysis,
    notes: [
      'Original RGB and alpha are preserved within technical crops; no threshold cleanup or retouching was applied.',
      'Every non-negligible visible detail in an inspected cell is included, even when a weapon/accessory is disconnected.',
      'One fixed uniform scale is shared by every drawing in this action; visible height is allowed to change naturally.',
      spec.anchor === 'head' ? 'The declared head-region alpha centroid stays fixed; feet can move naturally while suspended.' : 'The declared foot-region alpha centroid and sole baseline define translation anchors.',
      'Loop difference metrics are diagnostic and do not establish artistic approval.',
      '50fps video encoding repeats/holds these genuine drawings and does not create 50 unique poses per second.',
    ],
  };
  await fs.writeFile(path.join(sourceRoot, 'audits', `${spec.id}.json`), JSON.stringify({ ...group, frameGeometry: audits }, null, 2) + '\n');
  for (const bg of [{ name: 'light', r: 239, g: 241, b: 245 }, { name: 'dark', r: 30, g: 34, b: 42 }]) await sharp({ create: { width: spec.columns * 256, height: spec.rows * 256, channels: 4, background: { r: bg.r, g: bg.g, b: bg.b, alpha: 1 } } }).composite(tiles).png().toFile(path.join(sourceRoot, 'audits', `${spec.id}-contact-${bg.name}.png`));
  if (shouldEncode) {
    if (touchedSourceEdges.length) throw new Error(`${spec.id}: do not encode a production video from an edge-clipped source.`);
    const bundledFfmpeg = path.join(root, '.tools', 'ffmpeg', 'ffmpeg-9.0.2-essentials_build', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    let ffmpeg = process.env.FFMPEG_PATH;
    if (!ffmpeg) { try { await fs.access(bundledFfmpeg); ffmpeg = bundledFfmpeg; } catch { ffmpeg = 'ffmpeg'; } }
    const outputFile = path.resolve(root, spec.output);
    if (!outputFile.startsWith(path.join(root, 'assets', 'characters', characterId) + path.sep)) throw new Error('Output must stay inside this character asset directory.');
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
  processedGroups++;
  console.log(JSON.stringify({ id: spec.id, drawings: frames.length, scale, status: group.status, totalDurationMs: group.totalDurationMs, sourceEdgeWarnings: touchedSourceEdges, loopSeam: pairs.at(-1), video: group.video }, null, 2));
}
if (!inspectOnly && processedGroups) await fs.writeFile(path.join(sourceRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
