import { ImageResponse } from "next/og";
import { FLAME_DOTS } from "@/components/brand/logo";

export const alt = "blaze: any database in 200ms";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share card. Flat, like the landing page: the mark, the line, and amber only on 200ms. */
export default function OpengraphImage() {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				background: "#0a0a0b",
				color: "#ededef",
				padding: "72px 80px",
				position: "relative",
			}}
		>
			<div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
				<div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34 }}>
					<div style={{ display: "flex", position: "relative", width: 28, height: 36 }}>
						{FLAME_DOTS.map(([x, y, core]) => (
							<div
								key={`s-${x}-${y}`}
								style={{
									position: "absolute",
									left: x * 4,
									top: y * 4,
									width: 3,
									height: 3,
									borderRadius: 3,
									background: core ? "#ffc27a" : "#ff7a1a",
								}}
							/>
						))}
					</div>
					blaze
				</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
					<div style={{ fontSize: 84, letterSpacing: -3.5, lineHeight: 1 }}>Any database</div>
					<div style={{ display: "flex", fontSize: 84, letterSpacing: -3.5, lineHeight: 1 }}>
						in&nbsp;<span style={{ color: "#ff7a1a" }}>200ms</span>.
					</div>
					<div style={{ fontSize: 28, color: "#8b8b93", marginTop: 12, maxWidth: 640 }}>
						Free managed databases for agents and their builders, created from an API, an MCP server
						or the dashboard.
					</div>
				</div>
			</div>
		</div>,
		size,
	);
}
