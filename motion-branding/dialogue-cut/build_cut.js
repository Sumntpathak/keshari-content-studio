// Dialogue cut: two Gemini shots + two ElevenLabs voices + typed dialogue + typewriter sound + brand frame.
//  node build_cut.js <budhram_voice.mp3> <ganpat_voice.mp3> <shot1_vertical.mp4> <shot2_landscape.mp4> <out.mp4> [fontsDir]
const { chromium } = require('playwright');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const [VB, VG, S1, S2, OUT = 'dialogue_cut.mp4', FONTS = 'node_modules/@fontsource-fonts'] = process.argv.slice(2);
if (!VB || !VG || !S1 || !S2) { console.error('usage: node build_cut.js <budhram.mp3> <ganpat.mp3> <shot1.mp4> <shot2.mp4> <out.mp4> [fontsDir]'); process.exit(1); }
const FPS = 30, TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-'));
const sh = (c, a) => execFileSync(c, a, { stdio: ['ignore', 'ignore', 'inherit'], encoding: 'utf8' });
const dur = f => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }));

/* ---- dialogue (Chhattisgarhi) in story order; B = Budhram (Bunty), G = Ganpat (Alder) ---- */
const LINES = {
  B: ['जादू नइ भइया… घाम हे। मोर छानी म सोलर लगे हे। सूरज ले बिजली बनथे।',
      'उही तो गलती हे गनपत। कटिया ले पंखा धीरे चलथे… टीवी जर जथे… अउ तार म करेंट के खतरा अलग।',
      'बिजली चोरी म जुर्माना लगथे… गंभीर मामला म जेल तको हो सकथे। अउ अइसन म सब्सिडी घलो नइ मिलय।',
      'पहिली मीटर वाला सही कनेक्शन ले। फेर पी एम सूर्य घर योजना म सोलर लगवा… तीन किलोवाट म अठहत्तर हज़ार रुपिया तक सब्सिडी। बचे बिजली मीटर म जुड़ जथे… अउ बिल घट जथे।'],
  G: ['अरे बुधराम! पूरा गाँव म बत्ती गुल… तोर घर म फेर उजियार! का जादू हे जी?',
      'हहो? मैं तो चिंता नइ करँव… खम्भा ले सीधा कटिया डारे हँव। बिल के झंझट नइ।',
      'कालि बिजली विभाग के टीम आइस रहिस… कटिया पकड़ लिस। जुर्माना के पर्चा धरा दिस… लइका मन डेर्रा गे।',
      'त अब का करँव? बने रद्दा बता न।',
      'बने रद्दा त इही हे। चल… मैं तको घाम ले बिजली बनाहूँ।']
};
const ORDER = ['G0', 'B0', 'G1', 'B1', 'G2', 'B2', 'G3', 'B3', 'G4'];       // story order

/* ---- split a voice file into its lines at the pauses ---- */
function silences(f) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'silencedetect=noise=-38dB:d=0.28', '-f', 'null', '-'], { encoding: 'utf8' });
  const out = []; let s = null;
  for (const l of r.stderr.split('\n')) {
    let m = l.match(/silence_start: ([\d.]+)/); if (m) s = parseFloat(m[1]);
    m = l.match(/silence_end: ([\d.]+)/); if (m && s !== null) { out.push([s, parseFloat(m[1])]); s = null; }
  }
  return out;
}
const GS = new Intl.Segmenter('hi', { granularity: 'grapheme' });
const weight = t => [...GS.segment(t.replace(/[\s…।!?,.]/g, ''))].length;
function splitLines(file, texts) {                   // choose N-1 pauses so line lengths best match their text lengths
  const D = dur(file), N = texts.length, W = texts.map(weight), k = D / W.reduce((a, b) => a + b, 0);
  const cands = silences(file).filter(([s, e]) => s > 0.6 && e < D - 0.3);
  const INF = 1e18, M = cands.length;
  const best = Array.from({ length: N }, () => Array(M + 1).fill(INF)), from = Array.from({ length: N }, () => Array(M + 1).fill(-1));
  const cost = (a, b, w) => { const d = b - a, t = k * w; return (d - t) * (d - t) / (t + 0.5); };
  for (let j = 0; j < M; j++) best[0][j] = cost(0, cands[j][0], W[0]);
  for (let i = 1; i < N - 1; i++) for (let j = 0; j < M; j++) for (let p = 0; p < j; p++) {
    const c = best[i - 1][p] + cost(cands[p][1], cands[j][0], W[i]); if (c < best[i][j]) { best[i][j] = c; from[i][j] = p; }
  }
  let bj = -1, bc = INF;
  for (let j = 0; j < M; j++) { const c = best[N - 2][j] + cost(cands[j][1], D, W[N - 1]); if (c < bc) { bc = c; bj = j; } }
  const cuts = []; let j = bj; for (let i = N - 2; i >= 0; i--) { cuts.unshift(j); j = from[i][j]; }
  const segs = []; let a = 0;
  cuts.forEach(c => { segs.push([a, cands[c][0]]); a = cands[c][1]; }); segs.push([a, D]);
  return segs;
}
const segB = splitLines(VB, LINES.B), segG = splitLines(VG, LINES.G);
console.log('Budhram lines:', segB.map(s => s.map(x => x.toFixed(2)).join('-')).join('  '));
console.log('Ganpat  lines:', segG.map(s => s.map(x => x.toFixed(2)).join('-')).join('  '));

/* ---- timeline: as many lines as the two shots can carry ---- */
const D1 = dur(S1), D2 = dur(S2), XF = 0.4, MAXT = D1 + D2 - XF;
const lines = []; let t = 0.7;
for (const id of ORDER) {
  const spk = id[0], i = +id[1], seg = (spk === 'B' ? segB : segG)[i]; if (!seg) break;
  const d = seg[1] - seg[0] - 0.02;
  if (t + d + 1.0 > MAXT && lines.length >= 4) break;
  lines.push({ id, spk, text: LINES[spk][i].replace(/…/g, '...'), start: +t.toFixed(2), dur: +d.toFixed(2), src: spk === 'B' ? VB : VG, a: seg[0], b: seg[1] });
  t += d + 0.42;
}
const T = Math.min(MAXT, +(t - 0.42 + 1.2).toFixed(2)), D2use = Math.min(D2, T - (D1 - XF));
console.log(`Timeline: ${lines.length} lines, ${T}s`);
lines.forEach(l => console.log(`  ${l.start.toFixed(2).padStart(6)}s  ${l.spk}  ${l.dur.toFixed(2)}s  ${l.text.slice(0, 40)}`));

/* ---- cut the voice lines ---- */
lines.forEach((l, i) => {
  l.wav = path.join(TMP, `l${i}.wav`);
  sh('ffmpeg', ['-y', '-v', 'error', '-ss', String(l.a), '-t', String(l.dur + 0.02), '-i', l.src, '-af', `afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, l.dur - 0.04)}:d=0.04,aresample=44100,aformat=channel_layouts=stereo`, l.wav]);
});

/* ---- typewriter sound ---- */
function typingWav(events, total, file) {
  const sr = 44100, N = Math.ceil(total * sr), L = new Float32Array(N), R = new Float32Array(N);
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (const ev of events) {
    const st = Math.floor(ev.t * sr); if (st < 0 || st >= N) continue;
    const kind = ev.kind, len = Math.floor(sr * (kind === 'space' ? 0.075 : 0.05));
    const f = (kind === 'space' ? 900 : 1700) + rnd() * 700, g = (kind === 'space' ? 0.7 : 0.55) * (0.75 + rnd() * 0.25), pan = 0.35 + rnd() * 0.3; let prev = 0;
    for (let i = 0; i < len && st + i < N; i++) {
      const tt = i / sr, nz = rnd() * 2 - 1, hp = nz - prev; prev = nz;
      const v = (hp * Math.exp(-tt / 0.004) * 0.7 + Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt / 0.006) * 0.45 + Math.sin(2 * Math.PI * 130 * tt) * Math.exp(-tt / 0.02) * 0.55) * g;
      L[st + i] += v * (1 - pan * 0.5); R[st + i] += v * (0.5 + pan * 0.5);
    }
  }
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const k = pk ? 0.9 / pk : 1, buf = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * k * 32767), i * 4); buf.writeInt16LE(Math.round(R[i] * k * 32767), i * 4 + 2); }
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, buf]));
}

(async () => {
  /* ---- overlay graphics (header/footer once + typed dialogue card per frame) ---- */
  const html = fs.readFileSync(path.join(__dirname, 'cut.html'), 'utf8').replace(/FONTS\//g, FONTS.replace(/\\/g, '/') + '/');
  fs.writeFileSync(path.join(__dirname, '_cut_run.html'), html);
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  await page.goto('file://' + path.join(__dirname, '_cut_run.html')); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
  await page.evaluate(tl => window.setTimeline(tl), { lines: lines.map(({ spk, text, start, dur }) => ({ spk, text, start, dur })) });
  await page.evaluate(() => window.showStatic(true));
  const staticPng = path.join(TMP, 'static.png'); await page.screenshot({ path: staticPng, omitBackground: true });
  await page.evaluate(() => window.showStatic(false));
  const events = await page.evaluate(() => window.events()); console.log('typewriter key events:', events.length);
  const cardDir = path.join(TMP, 'card'); fs.mkdirSync(cardDir);
  const clip = { x: 0, y: 1260, width: 1080, height: 480 }, nF = Math.ceil(T * FPS);
  await page.evaluate(() => window.render(-1)); const blank = path.join(TMP, 'blank.png'); await page.screenshot({ path: blank, omitBackground: true, clip });
  for (let f = 0; f < nF; f++) {
    const tt = f / FPS, dst = path.join(cardDir, `f_${String(f + 1).padStart(5, '0')}.png`);
    if (lines.some(l => tt >= l.start - 0.1 && tt < l.start + l.dur + 0.9)) { await page.evaluate(x => window.render(x), tt); await page.screenshot({ path: dst, omitBackground: true, clip }); }
    else fs.copyFileSync(blank, dst);
    if (f % 90 === 0) process.stdout.write(`\r  graphics ${f}/${nF}  `);
  }
  await browser.close(); fs.rmSync(path.join(__dirname, '_cut_run.html'));
  const typ = path.join(TMP, 'typing.wav'); typingWav(events, T, typ);

  /* ---- composite ---- */
  const n = lines.length, off1 = D1 - XF, ms = x => Math.round(x * 1000);
  let fg = `
[0:v]fps=${FPS},scale=1080:1920:flags=lanczos:force_original_aspect_ratio=increase,crop=1080:1488,setsar=1,format=yuv420p[s1];
[1:v]fps=${FPS},trim=duration=${D2use.toFixed(2)},setpts=PTS-STARTPTS,split[a][b];
[a]scale=1080:1488:force_original_aspect_ratio=increase,crop=1080:1488,boxblur=30:5,eq=brightness=-0.06[bg];
[b]scale=1080:-2:flags=lanczos[fgv];[bg][fgv]overlay=0:(H-h)/2,setsar=1,format=yuv420p[s2];
[s1][s2]xfade=transition=fade:duration=${XF}:offset=${off1.toFixed(2)}[vid];
color=c=0x0b2447:s=1080x1920:r=${FPS}:d=${T}[canvas];[canvas][vid]overlay=0:242[c1];
[c1][2:v]overlay=0:0[c2];[c2][3:v]overlay=0:1260,format=yuv420p[vout];
[0:a]aresample=44100,aformat=channel_layouts=stereo[a1];[1:a]atrim=duration=${D2use.toFixed(2)},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[a2];
[a1][a2]acrossfade=d=${XF},volume=2.2[amb];[4:a]volume=0.5[typ];`;
  lines.forEach((l, i) => { fg += `[${5 + i}:a]adelay=${ms(l.start)}|${ms(l.start)}[v${i}];`; });
  fg += `[amb][typ]${lines.map((_, i) => `[v${i}]`).join('')}amix=inputs=${n + 2}:duration=longest:normalize=0,alimiter=limit=0.95,atrim=duration=${T}[aout]`;
  console.log('\nEncoding...');
  sh('ffmpeg', ['-y', '-v', 'error', '-i', S1, '-i', S2, '-loop', '1', '-framerate', String(FPS), '-t', String(T), '-i', staticPng,
    '-framerate', String(FPS), '-i', path.join(cardDir, 'f_%05d.png'), '-i', typ, ...lines.flatMap(l => ['-i', l.wav]),
    '-filter_complex', fg, '-map', '[vout]', '-map', '[aout]', '-t', String(T), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT]);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('Done ->', path.resolve(OUT));
})().catch(e => { console.error(e); process.exit(1); });
