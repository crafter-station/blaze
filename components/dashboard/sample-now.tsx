"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { sampleDatabaseAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * The sweep runs every 5 minutes, which is right for quota enforcement and wrong for
 * someone who just created a database and is looking at an empty chart.
 */
export function SampleNow({ id }: { id: string }) {
	const [pending, start] = useTransition();

	return (
		<Button
			variant="outline"
			disabled={pending}
			onClick={() =>
				start(async () => {
					const result = await sampleDatabaseAction(id);
					if (result.ok) toast.success("Sampled");
					else toast.error(result.error ?? "Failed to sample");
				})
			}
		>
			{pending ? (
				<Loader2 className="animate-spin" data-icon="inline-start" />
			) : (
				<RefreshCw data-icon="inline-start" />
			)}
			{pending ? "Sampling…" : "Sample now"}
		</Button>
	);
}
