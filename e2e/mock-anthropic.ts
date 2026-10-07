/**
 * A stand-in for the Anthropic Messages API, for exercising the SQL console's assistant
 * end to end without a real key or real spend.
 *
 *   bun e2e/mock-anthropic.ts            # listens on 127.0.0.1:4011
 *   ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:4011 bun dev
 *
 * Streams a canned answer as server-sent events in the Messages API shape, and logs each
 * request body so the payload (schema + the user's SQL, nothing else) can be inspected.
 */

const port = Number(process.env.MOCK_PORT ?? 4011);

function answerFor(body: { messages?: { content?: unknown }[] }): string {
	const text = JSON.stringify(body.messages?.[0]?.content ?? "");
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
		if (request.method !== "POST" || !url.pathname.endsWith("/v1/messages")) {
			return new Response("not found", { status: 404 });
		}
		const body = await request.json();
		console.log(
			JSON.stringify({
				path: url.pathname,
				beta: request.headers.get("anthropic-beta"),
				model: body.model,
				fallbacks: body.fallbacks,
				effort: body.output_config?.effort,
				stream: body.stream,
				system: String(body.system).slice(0, 80),
				user: body.messages?.[0]?.content,
			}),
		);
		const answer = answerFor(body);
		const chunks = answer.match(/[\s\S]{1,18}/g) ?? [];
		const stream = new ReadableStream({
			async start(controller) {
				const enc = new TextEncoder();
				const push = (e: string, d: unknown) => controller.enqueue(enc.encode(sse(e, d)));
				push("message_start", {
					type: "message_start",
					message: {
						id: "msg_mock",
						type: "message",
						role: "assistant",
						model: body.model,
						content: [],
						stop_reason: null,
						stop_sequence: null,
						usage: { input_tokens: 10, output_tokens: 0 },
					},
				});
				push("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				});
				for (const chunk of chunks) {
					await new Promise((r) => setTimeout(r, 25));
					push("content_block_delta", {
						type: "content_block_delta",
						index: 0,
						delta: { type: "text_delta", text: chunk },
					});
				}
				push("content_block_stop", { type: "content_block_stop", index: 0 });
				push("message_delta", {
					type: "message_delta",
					delta: { stop_reason: "end_turn", stop_sequence: null },
					usage: { output_tokens: chunks.length },
				});
				push("message_stop", { type: "message_stop" });
				controller.close();
			},
		});
		return new Response(stream, { headers: { "content-type": "text/event-stream" } });
	},
});

console.log(`mock Anthropic API on http://127.0.0.1:${port}`);
