import { ToolCall } from "../components/ToolCall";
import { mono } from "../fonts";
import { theme } from "../theme";

const COLUMNS = ["id", "task"];
const ROWS = [
	["1", "index docs"],
	["2", "write tests"],
];

export const Query: React.FC = () => (
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
			tool="run_query"
			args={
				'{ "sql": "create table agents(id serial primary key, task text);\n' +
				'          insert into agents(task) values (\'index docs\'),(\'write tests\');\n' +
				'          select * from agents" }'
			}
			result={
				<div
					style={{
						background: theme.card,
						border: `1px solid ${theme.border}`,
						borderRadius: theme.radius,
						overflow: "hidden",
					}}
				>
					<table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: 24 }}>
						<thead>
							<tr style={{ borderBottom: `1px solid ${theme.border}` }}>
								{COLUMNS.map((c) => (
									<th
										key={c}
										style={{ textAlign: "left", padding: "16px 24px", color: theme.muted, fontWeight: 500 }}
									>
										{c}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{ROWS.map((row) => (
								<tr key={row[0]} style={{ borderBottom: `1px solid ${theme.border}` }}>
									{row.map((cell) => (
										<td key={cell} style={{ padding: "16px 24px", color: theme.fg }}>
											{cell}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					<div style={{ padding: "14px 24px", color: theme.muted, fontFamily: mono, fontSize: 21 }}>
						2 rows · 67ms · runs as the database's own role
					</div>
				</div>
			}
		/>
	</div>
);
