import { Chip } from "../components/Panel";
import { ToolCall } from "../components/ToolCall";
import { mono } from "../fonts";
import { theme } from "../theme";

/**
 * Real values: the connection string shape the API returns and a latency actually
 * observed in production. Inventing a rounder number would be easy and would make every
 * other claim in the video worth less.
 */
export const Create: React.FC = () => (
	<div
		style={{
			position: "absolute",
			inset: 0,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: "0 160px",
		}}
	>
		<ToolCall
			tool="create_database"
			args={'{ "name": "scratch", "ttl_seconds": 86400 }'}
			result={
				<div
					style={{
						background: theme.card,
						border: `1px solid ${theme.border}`,
						borderRadius: theme.radius,
						padding: 24,
						display: "flex",
						flexDirection: "column",
						gap: 16,
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
						<Chip>Active</Chip>
						<Chip color={theme.warning}>expires in 24h</Chip>
						<span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 30, color: theme.fg }}>
							241ms
						</span>
					</div>
					<code
						style={{
							fontFamily: mono,
							fontSize: 20,
							color: theme.muted,
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							lineHeight: 1.5,
						}}
					>
						postgresql://u_scratch_q647:••••••••@pg.blaze.crafter.run:5433/db_scratch_x4k2?sslmode=require
					</code>
				</div>
			}
		/>
	</div>
);
