/**
 * The narration script and its scene mapping.
 *
 * Single source of truth: `scripts/generate-voice.mjs` reads this to synthesise one clip
 * per line, then writes `public/timing.json` with the *measured* duration of each clip.
 * Scenes and captions read that file, so subtitles, narration and cuts stay in sync
 * without anyone hand-tuning frame numbers.
 *
 * Every claim here is one blaze can back: the timings are numbers observed in production,
 * and the limits are the ones the API actually enforces.
 */

export type SceneKey = "title" | "setup" | "create" | "query" | "outro";

export interface Line {
	scene: SceneKey;
	text: string;
}

export const SCRIPT: Line[] = [
	{ scene: "title", text: "blaze gives you a managed Postgres database in about two hundred milliseconds." },
	{ scene: "title", text: "Free, and built for agents." },

	{ scene: "setup", text: "Paste one prompt into your agent and it configures itself." },
	{ scene: "setup", text: "There is no API key to copy. It authorizes over OAuth, and you approve once." },

	{ scene: "create", text: "Ask for a database, and you get a connection string back." },
	{ scene: "create", text: "Two hundred and forty one milliseconds, measured in production." },

	{ scene: "query", text: "The same agent runs SQL against it directly, with no driver in between." },
	{ scene: "query", text: "Give it a time to live, and the database cleans itself up." },

	{ scene: "outro", text: "Five databases, five hundred megabytes each, free while in alpha." },
	{ scene: "outro", text: "blaze dot crafter dot run." },
];

export const SCENE_ORDER: SceneKey[] = ["title", "setup", "create", "query", "outro"];
