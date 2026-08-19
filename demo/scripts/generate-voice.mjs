/**
 * Synthesises the voiceover, one clip per line, then derives every timing from the
 * *measured* duration of the rendered audio.
 *
 * Timing captions and scene cuts off real audio instead of guessing is what keeps
 * subtitles, narration and cuts in sync. Guessed durations drift within a sentence or two
 * and the whole video has to be re-tuned by hand after any script edit.
 *
 * Two providers, chosen automatically:
 *
 *   OPENAI_API_KEY=sk-...  node scripts/generate-voice.mjs   # production quality
 *   node scripts/generate-voice.mjs                          # offline Windows SAPI
 *
 * The fallback exists so the video is complete and renderable without anyone holding a
 * TTS credential. It sounds noticeably synthetic; set the key and re-run to replace every
 * clip and all timings in one pass.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPT, SCENE_ORDER } from "../src/script.ts";

const KEY = process.env.OPENAI_API_KEY;
const PROVIDER = KEY ? "openai" : "sapi";

/**
 * Narration speed. 1.5x is deliberately applied *after* synthesis with ffmpeg's atempo
 * rather than asked for in the prompt: TTS asked to "speak quickly" changes emphasis and
 * swallows word endings, while atempo is a pure time-stretch that preserves pitch and
 * articulation. Timings are then measured from the stretched clip, so nothing downstream
 * needs to know this happened.
 */
const SPEED = Number(process.env.VOICE_SPEED ?? 1.5);

// Gaps scale with the speed too — leaving them fixed would make a "faster" video that
// spends the same amount of time saying nothing.
const GAP_MS = Math.round(300 / SPEED);
const SCENE_GAP_MS = Math.round(620 / SPEED);
const LEAD_IN_MS = Math.round(500 / SPEED);

const root = process.cwd();
const outDir = join(root, "public", "audio");
mkdirSync(outDir, { recursive: true });

// Clear only the clips this script owns. Wiping the whole directory would also delete
// the cached music source, forcing a 7MB re-download on every voice run.
for (const name of readdirSync(outDir)) {
	if (/^line-\d+\.mp3$/.test(name)) rmSync(join(outDir, name), { force: true });
}

const durationMs = (file) => {
	const out = execFileSync("ffprobe", [
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		file,
	]).toString().trim();
	return Math.round(Number.parseFloat(out) * 1000);
};

async function synthOpenAI(text, file) {
	const response = await fetch("https://api.openai.com/v1/audio/speech", {
		method: "POST",
		headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
		body: JSON.stringify({
			model: "gpt-4o-mini-tts",
			voice: "onyx",
			input: text,
			instructions:
				"Calm, clear, confident product-demo narration. Unhurried. No exaggerated enthusiasm.",
		}),
	});
	if (!response.ok) throw new Error(`OpenAI TTS ${response.status}: ${await response.text()}`);
	writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

/** Time-stretch in place. atempo preserves pitch, so 1.5x does not sound chipmunked. */
function speedUp(file) {
	if (SPEED === 1) return;
	const tmp = file.replace(/\.mp3$/, ".raw.mp3");
	renameSync(file, tmp);
	execFileSync("ffmpeg", ["-y", "-i", tmp, "-filter:a", `atempo=${SPEED}`, "-b:a", "160k", file], {
		stdio: ["ignore", "ignore", "ignore"],
	});
	unlinkSync(tmp);
}

/**
 * Windows SAPI writes WAV, so it is converted to mp3 to keep one format downstream.
 * Rate is nudged down: the default cadence is too brisk to read subtitles against.
 */
function synthSapi(text, file) {
	const wav = file.replace(/\.mp3$/, ".wav");
	const escaped = text.replace(/'/g, "''");
	execFileSync("powershell", [
		"-NoProfile", "-Command",
		`Add-Type -AssemblyName System.Speech; ` +
		`$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
		`try { $s.SelectVoice('Microsoft Zira Desktop') } catch {}; ` +
		`$s.Rate = -1; ` +
		`$s.SetOutputToWaveFile('${wav}'); ` +
		`$s.Speak('${escaped}'); ` +
		`$s.Dispose()`,
	], { stdio: ["ignore", "ignore", "inherit"] });

	execFileSync("ffmpeg", ["-y", "-i", wav, "-b:a", "160k", file], {
		stdio: ["ignore", "ignore", "ignore"],
	});
	unlinkSync(wav);
}

console.log(`voice provider: ${PROVIDER}  speed: ${SPEED}x`);

const lines = [];
let cursor = LEAD_IN_MS;
let previousScene = null;

for (const [index, line] of SCRIPT.entries()) {
	const file = join(outDir, `line-${String(index).padStart(2, "0")}.mp3`);

	if (PROVIDER === "openai") await synthOpenAI(line.text, file);
	else synthSapi(line.text, file);
	speedUp(file);

	if (previousScene && previousScene !== line.scene) cursor += SCENE_GAP_MS;
	else if (previousScene) cursor += GAP_MS;

	const duration = durationMs(file);
	lines.push({
		scene: line.scene,
		text: line.text,
		file: `audio/line-${String(index).padStart(2, "0")}.mp3`,
		startMs: cursor,
		durationMs: duration,
	});

	cursor += duration;
	previousScene = line.scene;
	console.log(`  ${line.scene.padEnd(7)} ${String(duration).padStart(5)}ms  ${line.text.slice(0, 58)}`);
}

// Scene bounds come from the lines they contain, plus the gap that follows the last one,
// so a scene is exactly as long as its narration needs and never cuts a word in half.
const scenes = SCENE_ORDER.map((key, i) => {
	const own = lines.filter((l) => l.scene === key);
	const startMs = i === 0 ? 0 : own[0].startMs - SCENE_GAP_MS / 2;
	const last = own[own.length - 1];
	const endMs = last.startMs + last.durationMs + SCENE_GAP_MS / 2;
	return { key, startMs: Math.max(0, Math.round(startMs)), durationMs: Math.round(endMs - startMs) };
});

const TAIL_MS = 900; // let the last word land before the video ends
const totalMs = scenes[scenes.length - 1].startMs + scenes[scenes.length - 1].durationMs + TAIL_MS;

writeFileSync(
	join(root, "public", "timing.json"),
	`${JSON.stringify({ provider: PROVIDER, totalMs, lines, scenes }, null, 2)}\n`,
);

console.log(`\n${readdirSync(outDir).length} clips, total ${(totalMs / 1000).toFixed(1)}s`);
console.log("wrote public/timing.json");
