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

“Screen Saver” by Kevin MacLeod (incompetech.com), licensed **CC BY 4.0**.

CC BY permits commercial use — which a product demo is — but **requires attribution**.
The credit is burned into the outro frame so it travels with the file, and it must also
appear wherever the video is published. A credit that exists only in this README is not
attribution for a video posted to X.

`npm run music` downloads the source once into `public/audio/source/` (gitignored — it is
unmodified third-party work), then cuts it to the length the narration turned out to be,
normalises to -24 LUFS and fades both ends.

If you swap the track, update `ATTRIBUTION` in `scripts/generate-music.mjs` **and** the
line in `src/scenes/Outro.tsx`.

## Speed

Narration runs at 1.5x, applied with ffmpeg's `atempo` after synthesis rather than by
asking the model to talk faster — a TTS told to hurry swallows word endings, while
`atempo` is a pure time-stretch that preserves pitch. Override with `VOICE_SPEED=1`.

## Requirements

`ffmpeg` and `ffprobe` on PATH.
