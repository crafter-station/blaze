"use client";

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createDatabaseAction, deleteDatabaseAction } from "@/app/actions";
import { PROVISIONABLE } from "@/lib/engines/available";
import { ENGINE_CONFIG, ENGINES } from "@/lib/engines/types";

export function CreateDatabase({ atQuota }: { atQuota: boolean }) {
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);

	function submit(formData: FormData) {
		start(async () => {
			const result = await createDatabaseAction(formData);
			if (result.ok) {
				// Surfacing the real number keeps us honest: if provisioning drifts past 200ms
				// we find out from the product, not from a benchmark nobody runs.
				toast.success(`Database ready in ${result.tookMs}ms`);
				setOpen(false);
			} else {
				toast.error(result.error ?? "Failed to create database");
			}
		});
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				disabled={atQuota}
				className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				title={atQuota ? "Database limit reached — delete one first" : undefined}
			>
				<Plus className="size-4" />
				New database
			</button>
		);
	}

	return (
		<form
			action={submit}
			className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-5"
		>
			<label className="flex flex-col gap-1.5">
				<span className="text-muted-foreground text-xs">Name</span>
				<input
					name="name"
					placeholder="my-app"
					className="w-44 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
				/>
			</label>

			<label className="flex flex-col gap-1.5">
				<span className="text-muted-foreground text-xs">Engine</span>
				<select
					name="engine"
					defaultValue="postgres"
					className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
				>
					{ENGINES.map((engine) => (
						<option key={engine} value={engine} disabled={engine !== "postgres"}>
							{ENGINE_CONFIG[engine].label}
							{engine !== "postgres" ? " — soon" : ""}
						</option>
					))}
				</select>
			</label>

			<label className="flex flex-col gap-1.5">
				<span className="text-muted-foreground text-xs">Auto-delete after</span>
				<select
					name="ttlHours"
					defaultValue="0"
					className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
				>
					<option value="0">Never</option>
					<option value="1">1 hour</option>
					<option value="24">24 hours</option>
					<option value="168">7 days</option>
				</select>
			</label>

			<button
				type="submit"
				disabled={pending}
				className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm disabled:opacity-60"
			>
				{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
				{pending ? "Provisioning" : "Create"}
			</button>
			<button
				type="button"
				onClick={() => setOpen(false)}
				className="rounded-md px-3 py-2 text-muted-foreground text-sm hover:text-foreground"
			>
				Cancel
			</button>
		</form>
	);
}

export function DeleteDatabase({
	id,
	name,
	redirectTo,
}: {
	id: string;
	name: string;
	/** Where to go after deleting. The detail page must leave — its record is gone. */
	redirectTo?: string;
}) {
	const [pending, start] = useTransition();
	const [confirming, setConfirming] = useState(false);
	const router = useRouter();

	function remove() {
		start(async () => {
			const result = await deleteDatabaseAction(id);
			if (result.ok) {
				toast.success(`Deleted ${name}`);
				if (redirectTo) router.push(redirectTo);
			} else {
				toast.error(result.error ?? "Failed to delete");
			}
			setConfirming(false);
		});
	}

	// Two-step rather than a modal: dropping a database destroys data irreversibly, and a
	// single mis-click should not be enough to do it.
	if (!confirming) {
		return (
			<button
				type="button"
				onClick={() => setConfirming(true)}
				className="text-muted-foreground text-xs hover:text-destructive"
			>
				Delete
			</button>
		);
	}

	return (
		<span className="flex items-center gap-2 text-xs">
			<span className="text-muted-foreground">Delete permanently?</span>
			<button
				type="button"
				onClick={remove}
				disabled={pending}
				className="font-medium text-destructive disabled:opacity-60"
			>
				{pending ? "Deleting" : "Yes"}
			</button>
			<button type="button" onClick={() => setConfirming(false)} className="text-muted-foreground">
				No
			</button>
		</span>
	);
}
