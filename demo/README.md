# blaze demo video

55-second product demo: voiced, subtitled, with an ambient bed. Rendered with Remotion.

```bash
npm install
npm run audio     # voiceover + music, writes public/timing.json
npm run render    # out/blaze-demo.mp4
npm run dev       # Remotion Studio, for editing
```

## How timing works

`src/script.ts` is the single source of truth. `npm run voice` synthesises one clip per
line, measures each with `ffprobe`, and writes `public/timing.json` with real start times
and durations. Scenes, captions and the total video length all read that file.

Nothing here is a hand-tuned frame number — edit a line of narration, re-run `npm run
audio`, and the whole video re-times itself.

## Voice

Two providers, chosen automatically:

- `OPENAI_API_KEY=sk-... npm run voice` — `gpt-4o-mini-tts`, production quality.
- `npm run voice` — offline Windows SAPI. **This is what the current audio uses.** It
  sounds noticeably synthetic; set the key and re-run to replace every clip and all
  timings in one pass.

## Music

Generated with ffmpeg from sine tones — a slow Am–F–C–G pad, low-passed and normalised to
sit under narration.

Deliberately **not** a downloaded track. A royalty-free file still carries a licence with
attribution terms, a source that can vanish, and something nobody in the repo can
regenerate. Sine tones have no licence, reproduce identically anywhere, and re-cut to
whatever length the narration turns out to be — which matters, because the script decides
the duration, not the music.

## Requirements

`ffmpeg` and `ffprobe` on PATH.
