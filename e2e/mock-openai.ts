/**
 * A stand-in for the OpenAI Responses API, for exercising the SQL console's assistant end
 * to end without a real key or real spend.
 *
 *   bun e2e/mock-openai.ts               # listens on 127.0.0.1:4011
 *   OPENAI_API_KEY=test OPENAI_BASE_URL=http://127.0.0.1:4011/v1 bun dev
 *
 * Streams a canned answer as server-sent events in the Responses API shape, and logs each
 * request body so the payload (schema + the user's SQL, or the Redis key patterns + the
 * user's commands; nothing else) can be inspected.
 */

const port = Number(process.env.MOCK_PORT ?? 4011);

function answerFor(body: { input?: unknown }): string {
	const text = JSON.stringify(body.input ?? "");
	// The Redis console sends its keyspace (patterns and types, no values) in this tag.
	if (text.includes("<keyspace>")) {
		if (text.includes("Task: Fix")) {
			return "`HGETALL` takes exactly one key; the extra argument makes Redis reject the call.\n\n```redis\nHGETALL user:1\n```";
		}
		if (text.includes("Task: Explain")) {
			return "Reads the five highest scores from the weekly leaderboard, highest first.\n\n- `ZREVRANGE ... 0 4` walks the sorted set from the top, so it costs O(log N + 5).\n- `WITHSCORES` returns each member followed by its score.";
		}
		return "```redis\nZREVRANGE leaderboard:weekly 0 9 WITHSCORES\nHGETALL user:1\n```\n\nAssumes the leaderboard members are `player:<id>` names.";
	}
	if (text.includes("Task: Fix")) {
		return "The keyword `FROM` is misspelled as `frm`, so the parser reads `frm` as a column alias.\n\n```sql\nselect id, status\nfrom orders\nwhere total > 100;\n```";
	}
	if (text.includes("Task: Explain")) {
		return "This returns the 20 most recent **paid** orders with the customer's email.\n\n- `orders` is filtered on `status`, which `orders_status_created_at_idx` covers.\n- Each order joins to `customers` by primary key, so the join is cheap.";
	}
	return "```sql\nselect c.full_name, c.country, sum(o.total) as revenue\nfrom customers c\njoin orders o on o.customer_id = c.id\nwhere o.status in ('paid', 'shipped', 'delivered')\ngroup by c.id, c.full_name, c.country\norder by revenue desc\nlimit 10;\n```\n\nCounts paid, shipped and delivered orders as revenue.";
}

function sse(event: string, data: unknown) {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

Bun.serve({
	port,
	hostname: "127.0.0.1",
	async fetch(request) {
		const url = new URL(request.url);
		if (request.method !== "POST" || !url.pathname.endsWith("/v1/responses")) {
			return new Response("not found", { status: 404 });
		}
		const body = await request.json();
		console.log(
			JSON.stringify({
				path: url.pathname,
				model: body.model,
				effort: body.reasoning?.effort,
				store: body.store,
				stream: body.stream,
				instructions: String(body.instructions).slice(0, 80),
				input: body.input,
			}),
		);
		const answer = answerFor(body);
		const chunks = answer.match(/[\s\S]{1,18}/g) ?? [];
		const response = {
			id: "resp_mock",
			object: "response",
			model: body.model,
			status: "in_progress",
			output: [],
			incomplete_details: null,
		};
		const stream = new ReadableStream({
			async start(controller) {
				const enc = new TextEncoder();
				let seq = 0;
				const push = (type: string, data: Record<string, unknown>) =>
					controller.enqueue(enc.encode(sse(type, { type, sequence_number: seq++, ...data })));
				push("response.created", { response });
				for (const delta of chunks) {
					await new Promise((r) => setTimeout(r, 25));
					push("response.output_text.delta", {
						item_id: "msg_mock",
						output_index: 0,
						content_index: 0,
						delta,
					});
				}
				push("response.output_text.done", {
					item_id: "msg_mock",
					output_index: 0,
					content_index: 0,
					text: answer,
				});
				push("response.completed", { response: { ...response, status: "completed" } });
				controller.close();
			},
		});
		return new Response(stream, { headers: { "content-type": "text/event-stream" } });
	},
});

console.log(`mock OpenAI API on http://127.0.0.1:${port}`);
