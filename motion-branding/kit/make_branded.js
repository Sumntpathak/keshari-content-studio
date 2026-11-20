// Keshari branding renderer: logo intro + watermark + lower thirds + outro on any vertical video.
// Usage:  node make_branded.js "E:\Downloads\input.mp4" "E:\Downloads\output.mp4"
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const IN = process.argv[2], OUT = process.argv[3] || 'keshari_branded.mp4';
if (!IN || !fs.existsSync(IN)) { console.error('Usage: node make_branded.js <input video> [output.mp4]'); process.exit(1); }
const FPS = 30, INTRO = 3.0, OUTRO = 4.5, XF1 = 0.3, XF2 = 0.4;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'keshari-'));
const sh = (cmd, args, opt = {}) => execFileSync(cmd, args, { stdio: opt.quiet ? 'pipe' : 'inherit', encoding: 'utf8' });

// ---- 1. probe the input -------------------------------------------------
const D = parseFloat(sh('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', IN], { quiet: true }));
const hasAudio = sh('ffprobe', ['-v','error','-select_streams','a','-show_entries','stream=index','-of','csv=p=0', IN], { quiet: true }).trim() !== '';
console.log(`Input: ${D.toFixed(2)}s, audio: ${hasAudio}`);

// ---- 2. render animation frames (HTML -> PNG) ----------------------------
async function renderFrames(page, scene, dur, variant) {
  const dir = path.join(T, scene + (variant || '')); fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(dur * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate(([s, t, v]) => window.renderFrame(s, t, v), [scene, i / FPS, variant || 'a']);
    await page.screenshot({ path: path.join(dir, `f_${String(i).padStart(4, '0')}.png`), omitBackground: scene === 'lt' || scene === 'wm' });
    if (i % 30 === 0) process.stdout.write(`\r  ${scene}${variant || ''}: ${i}/${n}   `);
  }
  console.log(`\r  ${scene}${variant || ''}: done        `);
  return dir;
}
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.resolve(__dirname, 'brand.html'));
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(600);
  console.log('Rendering animation frames...');
  const intro = await renderFrames(page, 'intro', INTRO);
  const outro = await renderFrames(page, 'outro', OUTRO);
  const ltA = await renderFrames(page, 'lt', 4, 'a');
  const ltB = await renderFrames(page, 'lt', 4, 'b');
  await page.evaluate(() => window.renderFrame('wm', 0));
  const wm = path.join(T, 'wm.png'); await page.screenshot({ path: wm, omitBackground: true });
  await browser.close();

  // ---- 3. chime + whoosh sound (written as a WAV) -----------------------
  const sr = 44100, len = Math.floor(sr * 2.4), buf = Buffer.alloc(len * 4);
  const notes = [[1046.5, 0, 3, .35], [1318.5, .12, 3, .3], [1568, .24, 2.5, .3], [2093, .36, 2, .22]];
  let seed = 1, rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - .5, prev = 0, sum = 0, win = [], peak = 0;
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr; let v = 0;
    for (const [f, st, dec, a] of notes) if (t >= st) { const tt = t - st; v += a * Math.sin(2 * Math.PI * f * tt) * Math.exp(-dec * tt) + a * .25 * Math.sin(4 * Math.PI * f * tt) * Math.exp(-dec * 1.6 * tt); }
    const n = rnd(); prev = prev * .8 + n * .2;               // simple low-pass noise
    const env = t < 1.8 ? (t < .9 ? Math.pow(t / .9, 2) : Math.exp(-(t - .9) * 5)) : 0;
    v += .35 * (.6 * prev + .4 * n) * env; x[i] = v; peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < len; i++) { const s = Math.round(x[i] / peak * .7 * 32767); buf.writeInt16LE(s, i * 4); buf.writeInt16LE(s, i * 4 + 2); }
  const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + buf.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(buf.length, 40);
  const sfx = path.join(T, 'sfx.wav'); fs.writeFileSync(sfx, Buffer.concat([hdr, buf]));

  // ---- 4. composite with ffmpeg ------------------------------------------
  const off1 = INTRO - XF1;                 // intro -> video crossfade start
  const off2 = INTRO + D - XF1 - XF2;       // video -> outro crossfade start
  const total = off2 + OUTRO;
  const tA1 = 4.5, tB = Math.max(6, D * 0.36), tA2 = Math.max(tB + 6, D - 8.5);   // lower-third times (in video time)
  const aDelay = Math.round(off1 * 1000), oDelay = Math.round((off2 - 0.37) * 1000);
  const fg = `
[0:v]format=yuv420p,setsar=1[intro];
[1:v]fps=${FPS},scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p[bv];
[2:v]format=rgba,fade=in:st=0.6:d=0.6:alpha=1[wm];
[3:v]format=rgba,split[a0][a1];
[a0]setpts=PTS+${tA1}/TB[la1];
[a1]setpts=PTS+${tA2}/TB[la2];
[4:v]format=rgba,setpts=PTS+${tB}/TB[lb];
[bv][wm]overlay=0:0:eof_action=pass[v1];
[v1][la1]overlay=0:0:eof_action=pass[v2];
[v2][lb]overlay=0:0:eof_action=pass[v3];
[v3][la2]overlay=0:0:eof_action=pass,format=yuv420p[main];
[5:v]format=yuv420p,setsar=1[outro];
[intro][main]xfade=transition=fade:duration=${XF1}:offset=${off1}[x1];
[x1][outro]xfade=transition=fade:duration=${XF2}:offset=${off2}[vout];
${hasAudio ? `[1:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${aDelay}|${aDelay}[va];` : `anullsrc=r=44100:cl=stereo,atrim=0:${total.toFixed(2)}[va];`}
[6:a]asplit=2[s1][s2];[s2]adelay=${oDelay}|${oDelay}[so];
[va][s1][so]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.95[aout]`;
  console.log('Compositing with ffmpeg (a few minutes)...');
  sh('ffmpeg', ['-y',
    '-framerate', FPS, '-i', path.join(intro, 'f_%04d.png'),
    '-i', IN,
    '-loop', '1', '-t', String(Math.ceil(D + 2)), '-framerate', FPS, '-i', wm,
    '-framerate', FPS, '-i', path.join(ltA, 'f_%04d.png'),
    '-framerate', FPS, '-i', path.join(ltB, 'f_%04d.png'),
    '-framerate', FPS, '-i', path.join(outro, 'f_%04d.png'),
    '-i', sfx,
    '-filter_complex', fg, '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', OUT]);
  fs.rmSync(T, { recursive: true, force: true });
  console.log('\nDone ->', path.resolve(OUT));
})().catch(e => { console.error(e); process.exit(1); });
