import { Composition } from "remotion";
import { BlazeDemo } from "./Composition";
import { VIDEO } from "./theme";
import timing from "../public/timing.json";
import "./index.css";

export const RemotionRoot: React.FC = () => {
	// Total length is whatever the narration turned out to be, plus the tail the voice
	// script already accounted for. Hard-coding it would silently truncate the outro the
	// first time someone edits a line.
	const durationInFrames = Math.round((timing.totalMs / 1000) * VIDEO.fps);

	return (
		<Composition
			id="BlazeDemo"
			component={BlazeDemo}
			durationInFrames={durationInFrames}
			fps={VIDEO.fps}
			width={VIDEO.width}
			height={VIDEO.height}
		/>
	);
};
