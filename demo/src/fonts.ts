import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

/**
 * Same faces as the product. A demo in a different typeface reads as a different product,
 * and the whole point of this video is to look like the thing it is selling.
 */
/*
 * Only the weights and subset actually used. The default loads every weight and every
 * subset — around 100 network requests per face on every render, for glyphs no scene
 * contains.
 */
export const sans = loadGeist("normal", {
	weights: ["400", "500", "600"],
	subsets: ["latin"],
}).fontFamily;

export const mono = loadGeistMono("normal", {
	weights: ["400", "500"],
	subsets: ["latin"],
}).fontFamily;
