"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { sampleDatabaseAction } from "@/app/actions";

/**
 * The sweep runs every 5 minutes, which is right for quota enforcement and wrong for
 * someone who just created a database and is looking at an empty chart.
 */
export function SampleNow({ id }: { id: string }) {
	const [pending, start] = useTransition();

	return (
		<button
			type="button"
			disabled={pending}
			onClick={() =>
				start(async () => {
					const result = await sampleDatabaseAction(id);
					if (result.ok) toast.success("Sampled");
					else toast.error(result.error ?? "Failed to sample");
				})
			}
			className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm transition-colors hover:bg-accent disabled:opacity-60"
		>
			{pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
			{pending ? "Sampling" : "Sample now"}
		</button>
	);
}
