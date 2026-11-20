# Keshari narration video kit

Voice + brand frame + typing animation + typewriter sound, built from your ElevenLabs voice file.

## Run (Windows, PowerShell)
```powershell
# one time
winget install Gyan.FFmpeg
winget install OpenJS.NodeJS.LTS
# (close and reopen PowerShell)

git pull
cd motion-branding\narration-kit
npm install
npx playwright install chromium

# 1. copy your voice file here and name it voice.mp3
# 2. find when each beat starts (reads the pauses in your audio)
node make_video.js voice.mp3 --timing-only
# 3. optional: preview one frame at 20 seconds -> shot.png
node make_video.js voice.mp3 --timing timing.json --shot 20
# 4. full render
node make_video.js voice.mp3 keshari_narration.mp4 --timing timing.json
```

## If something is off
- **A beat appears early/late:** open `timing.json`, change that beat's `start` (and the previous beat's `end`), re-run step 4.
- **"Anchor not found":** `narration.txt` must be the exact words spoken in your voice file. Edit it, and edit the matching phrase in `anchors.json`.
- **Typing too loud/quiet:** in `make_video.js` change `volume=0.55`.
- **Slow render:** `--workers 6`. **Test render:** `--fps 15`.
- **Change on-screen words/numbers:** `narration.html`, function `buildBeats()`.

## Check before publishing
- 28,824 / 220 / 2,047 MW figures (they add up to 31,091 MW, the report's total is 30,671.7 MW): verify.
- 2030 target (8,689 MW): is it capacity or generation? verify.
- Chhattisgarh top-up subsidy is NOT shown (unconfirmed).
- "1,00,000+ pumps" is a 2022 figure.
- The voice says "करोड़ों घरों"; the on-screen figure says 1 crore target / 48 lakh+ done.
