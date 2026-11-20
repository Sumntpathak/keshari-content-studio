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

  // ---- 3. chime + whoosh: the exact sound file used in the shared render ----
  const sfx = path.join(__dirname, 'sfx.wav');

  // ---- 4. composite with ffmpeg ------------------------------------------
  const off1 = INTRO - XF1;                 // intro -> video crossfade start
  const off2 = INTRO + D - XF1 - XF2;       // video -> outro crossfade start
  const total = off2 + OUTRO;
  const tA1 = 4.5, tB = Math.min(16.5, D * 0.36), tA2 = Math.max(tB + 6, D - 8.57);   // lower-third times (in video time)
  const aDelay = Math.round(off1 * 1000), oDelay = Math.round((off2 - 0.37) * 1000);
  const fg = `
[0:v]format=yuv420p,setsar=1[intro];
[1:v]fps=${FPS},scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,format=yuv420p[bv];
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
