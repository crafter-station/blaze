"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { resetPasswordAction } from "@/app/actions";

/**
 * Two-step, like delete. Rotating a password silently breaks every deployed app still
 * holding the old one, so the confirm states that consequence rather than asking a bare
 * "are you sure?" that carries no information.
 */
export function ResetPassword({ id }: { id: string }) {
	const [pending, start] = useTransition();
	const [confirming, setConfirming] = useState(false);

	function reset() {
		start(async () => {
			const result = await resetPasswordAction(id);
			if (result.ok) toast.success("Password rotated — copy the new connection string");
			else toast.error(result.error ?? "Failed to rotate password");
			setConfirming(false);
		});
	}

	if (!confirming) {
		return (
			<button
				type="button"
				onClick={() => setConfirming(true)}
				className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm transition-colors hover:bg-accent"
			>
				<KeyRound className="size-4" />
				Reset password
			</button>
		);
	}

	return (
		<span className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm">
			<span className="text-warning">Existing apps will stop connecting.</span>
			<button
				type="button"
				onClick={reset}
				disabled={pending}
				className="inline-flex items-center gap-1.5 font-medium text-foreground disabled:opacity-60"
			>
				{pending && <Loader2 className="size-3.5 animate-spin" />}
				{pending ? "Rotating" : "Rotate"}
			</button>
			<button
				type="button"
				onClick={() => setConfirming(false)}
				className="text-muted-foreground hover:text-foreground"
			>
				Cancel
			</button>
		</span>
	);
}
