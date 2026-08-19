import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { Backdrop } from "./components/Backdrop";
import { Captions } from "./components/Captions";
import { Create } from "./scenes/Create";
import { Outro } from "./scenes/Outro";
import { Query } from "./scenes/Query";
import { Setup } from "./scenes/Setup";
import { Title } from "./scenes/Title";
import { theme } from "./theme";
import timing from "../public/timing.json";

/**
 * The demo.
 *
 * Every duration comes from `public/timing.json`, which is derived from the measured
 * length of the generated audio. Nothing here is a hand-tuned frame count, so re-running
 * the voice script after a script edit re-times the whole video automatically.
 */
const SCENES = { title: Title, setup: Setup, create: Create, query: Query, outro: Outro } as const;

export const BlazeDemo: React.FC = () => {
	const { fps } = useVideoConfig();
	const toFrames = (ms: number) => Math.round((ms / 1000) * fps);

	return (
		<AbsoluteFill style={{ background: theme.bg }}>
			<Backdrop />

			{timing.scenes.map((scene) => {
				const Scene = SCENES[scene.key as keyof typeof SCENES];
				return (
					<Sequence
						key={scene.key}
						from={toFrames(scene.startMs)}
						durationInFrames={toFrames(scene.durationMs)}
						name={scene.key}
					>
						<Scene />
					</Sequence>
				);
			})}

			{/*
			 * Narration clips are placed at absolute time rather than nested inside scenes:
			 * a clip that outlives its scene would otherwise be cut off mid-word.
			 */}
			{timing.lines.map((line) => (
				<Sequence key={line.file} from={toFrames(line.startMs)} name={`vo:${line.scene}`}>
					<Audio src={staticFile(line.file)} />
				</Sequence>
			))}

			{/*
			 * Audible, but under the voice. The previous cut paired a -30 LUFS bed with 0.16
			 * gain, which put the music below the noise floor of most playback — it was
			 * effectively not there. The track is now normalised to -24 and mixed at 0.32.
			 */}
			<Audio src={staticFile("audio/music.mp3")} volume={0.32} />

			<Captions />
		</AbsoluteFill>
	);
};
