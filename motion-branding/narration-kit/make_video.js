// Keshari narration video: voice + brand frame + typing animation + typewriter sound.
//
//  node make_video.js <voice.mp3> [output.mp4] [--timing timing.json] [--timing-only]
//                     [--workers 4] [--fps 30] [--shot <seconds>]
//
//  1) node make_video.js voice.mp3 --timing-only     -> writes timing.json (when each beat starts); check/edit it
//  2) node make_video.js voice.mp3 out.mp4 --timing timing.json   -> full render
const { chromium } = require('playwright');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

/* ---------------- args ---------------- */
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const timingFile = flag('--timing');
const WORKERS = parseInt(flag('--workers', Math.max(2, Math.min(6, os.cpus().length - 1))), 10);
const FPS = parseInt(flag('--fps', '30'), 10);
const shotAt = flag('--shot');
const timingOnly = has('--timing-only');
const [VOICE, OUT = 'keshari_narration.mp4'] = args;
if (!VOICE || !fs.existsSync(VOICE)) { console.error('Usage: node make_video.js <voice.mp3> [output.mp4] [--timing timing.json] [--timing-only] [--shot sec]'); process.exit(1); }
const TAIL = 0.8;

/* ---------------- 1. timing: align the narration text to the audio ---------------- */
function probe() {
  const d = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', VOICE], { encoding: 'utf8' }));
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', VOICE, '-af', 'silencedetect=noise=-35dB:d=0.30', '-f', 'null', '-'], { encoding: 'utf8' });
  const sil = []; let s = null;
  for (const line of r.stderr.split('\n')) {
    let m = line.match(/silence_start: ([\d.]+)/); if (m) s = parseFloat(m[1]);
    m = line.match(/silence_end: ([\d.]+)/); if (m && s !== null) { sil.push([s, parseFloat(m[1])]); s = null; }
  }
  return { duration: d, silences: sil };
}
function align({ duration, silences }) {
  const GS = new Intl.Segmenter('hi', { granularity: 'grapheme' });
  const clean = t => t.replace(/[।,.?!"“”'’]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean(fs.readFileSync(path.join(__dirname, 'narration.txt'), 'utf8')).split(' ');
  const weight = w => [...GS.segment(w)].length + 1;
  // speech-only ranges (voice present), then spread words over them by size
  const ranges = []; let cur = 0;
  for (const [s, e] of silences) { if (s > cur + 0.05) ranges.push([cur, s]); cur = e; }
  if (cur < duration) ranges.push([cur, duration]);
  const speech = ranges.reduce((a, [s, e]) => a + (e - s), 0);
  const totalW = words.reduce((a, w) => a + weight(w), 0);
  const toReal = x => { let acc = 0; for (const [s, e] of ranges) { if (x <= acc + (e - s)) return s + (x - acc); acc += e - s; } return duration; };
  let cw = 0; const start = words.map(w => { const t = toReal(speech * cw / totalW); cw += weight(w); return t; });
  // beats from anchors
  const anchors = JSON.parse(fs.readFileSync(path.join(__dirname, 'anchors.json'), 'utf8'));
  const beats = []; let from = 0;
  anchors.forEach((a, bi) => {
    const aw = clean(a).split(' ');
    let idx = -1;
    for (let i = from; i <= words.length - aw.length; i++) if (aw.every((x, j) => words[i + j] === x)) { idx = i; break; }
    if (idx < 0) throw new Error(`Anchor not found in narration.txt: "${a}" (beat ${bi + 1}). Make narration.txt match the voice exactly.`);
    from = idx + 1;
    beats.push({ anchor: a, start: bi === 0 ? 0 : Math.max(0, start[idx] - 0.12) });
  });
  const total = duration + TAIL;
  beats.forEach((b, i) => b.end = i < beats.length - 1 ? beats[i + 1].start : total);
  return { duration, total, beats: beats.map(b => ({ ...b, start: +b.start.toFixed(2), end: +b.end.toFixed(2) })) };
}
let timing;
if (timingFile) timing = JSON.parse(fs.readFileSync(timingFile, 'utf8'));
else {
  console.log('Analysing audio...');
  timing = align(probe());
  fs.writeFileSync('timing.json', JSON.stringify(timing, null, 2));
}
console.log('\nBeat start times (edit timing.json if a beat is early/late, then use --timing timing.json):');
timing.beats.forEach((b, i) => console.log(`  ${String(i + 1).padStart(2)}  ${b.start.toFixed(2).padStart(7)}s   ${b.anchor}`));
if (timingOnly) { console.log('\nSaved timing.json'); process.exit(0); }

/* ---------------- 2. typewriter sound ---------------- */
function makeTypingWav(events, total, file) {
  const sr = 44100, N = Math.ceil(total * sr);
  const L = new Float32Array(N), R = new Float32Array(N);
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (const ev of events) {
    const start = Math.floor(ev.t * sr); if (start < 0 || start >= N) continue;
    const kind = ev.kind, len = Math.floor(sr * (kind === 'return' ? 0.16 : kind === 'space' ? 0.075 : 0.05));
    const f = (kind === 'space' ? 900 : kind === 'return' ? 700 : 1700) + rnd() * 700;
    const gain = (kind === 'return' ? 0.95 : kind === 'space' ? 0.7 : 0.55) * (0.75 + rnd() * 0.25);
    const pan = 0.35 + rnd() * 0.3; let prev = 0;
    for (let i = 0; i < len && start + i < N; i++) {
      const t = i / sr, nz = rnd() * 2 - 1, hp = nz - prev; prev = nz;
      let v = hp * Math.exp(-t / 0.004) * 0.7                       // key "tick" (high-passed noise)
            + Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.006) * 0.45   // plastic resonance
            + Math.sin(2 * Math.PI * 130 * t) * Math.exp(-t / 0.02) * 0.55; // thump
      if (kind === 'return') v += Math.sin(2 * Math.PI * 2600 * t) * Math.exp(-t / 0.09) * 0.25; // little bell
      v *= gain; L[start + i] += v * (1 - pan * 0.5); R[start + i] += v * (0.5 + pan * 0.5);
    }
  }
  let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 0 ? 0.9 / peak : 1, buf = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * k * 32767), i * 4); buf.writeInt16LE(Math.round(R[i] * k * 32767), i * 4 + 2); }
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, buf]));
}

/* ---------------- 3. render ---------------- */
(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'keshari-narr-'));
  const browser = await chromium.launch();
  const newPage = async () => {
    const p = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    p.on('pageerror', e => { console.error('PAGE ERROR:', e.message); });
    await p.goto('file://' + path.resolve(__dirname, 'narration.html'));
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
    const info = await p.evaluate(t => window.setTiming(t), timing);
    return { p, info };
  };

  if (shotAt !== undefined) {                                   // quick single-frame preview
    const { p, info } = await newPage();
    console.log('Beat fit (k=1 means no speed-up needed):', JSON.stringify(info));
    await p.evaluate(t => window.renderFrame(t), parseFloat(shotAt));
    await p.screenshot({ path: 'shot.png' });
    await browser.close(); console.log('Saved shot.png'); process.exit(0);
  }

  const first = await newPage();
  const slow = first.info.map((x, i) => x.k < 0.75 ? `  beat ${i + 1}: animation sped up (k=${x.k})` : null).filter(Boolean);
  if (slow.length) console.log('\nNote: these beats are short, so their typing runs faster:\n' + slow.join('\n'));
  const events = await first.p.evaluate(() => window.typeEvents());
  console.log(`\nTypewriter sound: ${events.length} key events`);
  const wav = path.join(TMP, 'typing.wav'); makeTypingWav(events, timing.total, wav);

  const frames = Math.ceil(timing.total * FPS), pages = [first.p];
  for (let i = 1; i < WORKERS; i++) pages.push((await newPage()).p);
  console.log(`Rendering ${frames} frames with ${WORKERS} workers...`);
  let done = 0; const t0 = Date.now();
  await Promise.all(pages.map(async (p, w) => {
    for (let f = w; f < frames; f += WORKERS) {
      await p.evaluate(t => window.renderFrame(t), f / FPS);
      await p.screenshot({ path: path.join(TMP, `f_${String(f + 1).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
      if (++done % 60 === 0) { const el = (Date.now() - t0) / 1000; process.stdout.write(`\r  ${done}/${frames}  (${Math.round(done / el)} fps, ~${Math.round((frames - done) / (done / el))}s left)   `); }
    }
  }));
  await browser.close(); console.log('\nEncoding with ffmpeg...');

  const fg = '[1:a]aresample=44100,aformat=channel_layouts=stereo,apad[v];[2:a]aformat=channel_layouts=stereo,volume=0.55[t];' +
             '[v][t]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]';
  execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(TMP, 'f_%05d.jpg'), '-i', VOICE, '-i', wav,
    '-filter_complex', fg, '-map', '0:v', '-map', '[a]', '-t', timing.total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\nDone ->', path.resolve(OUT));
})().catch(e => { console.error(e); process.exit(1); });
