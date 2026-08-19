/**
 * Prepares the background track: fetch once, then cut it to the length the narration
 * actually turned out to be.
 *
 *   node scripts/generate-music.mjs           # length read from public/timing.json
 *   node scripts/generate-music.mjs 40000     # or given explicitly, in ms
 *
 * ## The track
 *
 * "Screen Saver" by Kevin MacLeod (incompetech.com), licensed **CC BY 4.0**.
 * https://creativecommons.org/licenses/by/4.0/
 *
 * CC BY permits commercial use, which a product demo is, but it **requires attribution**.
 * That obligation is not optional and does not disappear because the file sits in a repo:
 * wherever this video is published, the description has to carry the credit in
 * `ATTRIBUTION` below. That is the trade for using a real track instead of a synthesised
 * pad — better music, one string you must not drop.
 *
 * The source mp3 is cached in `public/audio/source/` and gitignored: it is 7MB of
 * unmodified third-party work, and the repo only needs the cut version it actually plays.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ATTRIBUTION =
	'"Screen Saver" by Kevin MacLeod (incompetech.com) — licensed under CC BY 4.0';

const SOURCE_URL =
	"https://incompetech.com/music/royalty-free/mp3-royaltyfree/Screen%20Saver.mp3";

const root = process.cwd();
const outDir = join(root, "public", "audio");
const srcDir = join(outDir, "source");
mkdirSync(srcDir, { recursive: true });

const source = join(srcDir, "screen-saver.mp3");

if (!existsSync(source)) {
	console.log("downloading source track…");
	const response = await fetch(SOURCE_URL, { headers: { "user-agent": "Mozilla/5.0" } });
	if (!response.ok) throw new Error(`download failed: ${response.status}`);
	writeFileSync(source, Buffer.from(await response.arrayBuffer()));
}

const timingPath = join(root, "public", "timing.json");
const TOTAL_MS = Number(
	process.argv[2] ??
		(existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, "utf8")).totalMs : 40000),
);
const seconds = TOTAL_MS / 1000;

const music = join(outDir, "music.mp3");

/*
 * loudnorm to -24 LUFS, not the -30 the synthesised pad used. That value was the reason
 * the bed was inaudible in the last cut: -30 plus a 0.16 gain in Remotion put it far
 * below the noise floor of most playback. -24 with a modest gain sits under the voice and
 * can still be heard.
 *
 * The track is longer than the video, so it is simply trimmed — and faded at both ends so
 * it neither starts on a transient nor stops mid-phrase.
 */
execFileSync("ffmpeg", [
	"-y",
	"-t", seconds.toFixed(2),
	"-i", source,
	"-af",
	[
		"loudnorm=I=-24:TP=-3:LRA=11",
		"afade=t=in:st=0:d=1.2",
		`afade=t=out:st=${(seconds - 2.5).toFixed(2)}:d=2.5`,
	].join(","),
	"-b:a", "192k",
	music,
], { stdio: ["ignore", "ignore", "ignore"] });

const dur = execFileSync("ffprobe", [
	"-v", "error",
	"-show_entries", "format=duration",
	"-of", "default=noprint_wrappers=1:nokey=1",
	music,
]).toString().trim();

console.log(`wrote public/audio/music.mp3 — ${Number(dur).toFixed(1)}s (target ${seconds.toFixed(1)}s)`);
console.log(`attribution required: ${ATTRIBUTION}`);
