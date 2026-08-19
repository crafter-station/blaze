/**
 * Synthesises a quiet ambient bed with ffmpeg.
 *
 * Deliberately generated rather than downloaded. A "royalty-free" track still carries a
 * licence with attribution terms, a source that can disappear, and a file nobody in the
 * repo can regenerate. Sine tones have no licence at all, reproduce identically on any
 * machine, and can be re-cut to whatever length the narration turns out to be — which is
 * the actual requirement, since the script decides the duration, not the music.
 *
 *   node scripts/generate-music.mjs           # length read from public/timing.json
 *   node scripts/generate-music.mjs 72000     # or given explicitly, in ms
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "public", "audio");
const tmpDir = join(outDir, "tmp");
mkdirSync(tmpDir, { recursive: true });

const timingPath = join(root, "public", "timing.json");
const TOTAL_MS = Number(
	process.argv[2] ??
		(existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, "utf8")).totalMs : 60000),
);
const SECTION_S = TOTAL_MS / 1000 / 4;

// Am – F – C – G, voiced low and wide so it reads as a pad rather than as notes.
const CHORDS = [
	[110.0, 164.81, 261.63],
	[87.31, 130.81, 261.63],
	[130.81, 196.0, 329.63],
	[98.0, 146.83, 293.66],
];

const files = [];
CHORDS.forEach((chord, i) => {
	const file = join(tmpDir, `chord-${i}.wav`);
	const inputs = chord.flatMap((f) => [
		"-f", "lavfi",
		"-t", String(SECTION_S),
		"-i", `sine=frequency=${f}:sample_rate=48000`,
	]);

	// Mix the tones, roll off the top so it sits under speech, breathe with a slow
	// tremolo, then cross-fade the section edges so chord changes are not audible as cuts.
	const filter =
		`${chord.map((_, j) => `[${j}:a]volume=0.33[t${j}]`).join(";")};` +
		`${chord.map((_, j) => `[t${j}]`).join("")}` +
		`amix=inputs=${chord.length}:normalize=0,` +
		"lowpass=f=700,tremolo=f=0.12:d=0.35," +
		`afade=t=in:st=0:d=2,afade=t=out:st=${(SECTION_S - 2).toFixed(2)}:d=2[out]`;

	execFileSync("ffmpeg", ["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", file], {
		stdio: ["ignore", "ignore", "ignore"],
	});
	files.push(file);
});

const listFile = join(tmpDir, "list.txt");
writeFileSync(listFile, files.map((f) => `file '${f.split("\\").join("/")}'`).join("\n"));

const music = join(outDir, "music.mp3");
execFileSync("ffmpeg", [
	"-y",
	"-f", "concat", "-safe", "0", "-i", listFile,
	// Sit well under the voice. The final balance is set in Remotion with volume().
	"-af",
	`loudnorm=I=-30:TP=-6:LRA=11,afade=t=out:st=${(TOTAL_MS / 1000 - 3).toFixed(2)}:d=3`,
	"-b:a", "160k",
	music,
], { stdio: ["ignore", "ignore", "ignore"] });

rmSync(tmpDir, { recursive: true, force: true });

const dur = execFileSync("ffprobe", [
	"-v", "error",
	"-show_entries", "format=duration",
	"-of", "default=noprint_wrappers=1:nokey=1",
	music,
]).toString().trim();

console.log(`wrote public/audio/music.mp3 — ${Number(dur).toFixed(1)}s (target ${(TOTAL_MS / 1000).toFixed(1)}s)`);
