"use client";

import { Check, Copy, Loader2, Plus, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions";

export function CreateApiKey({ atLimit }: { atLimit: boolean }) {
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);
	const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);

	function submit(formData: FormData) {
		start(async () => {
			const result = await createApiKeyAction(formData);
			if (result.ok && result.token) {
				setIssued({ token: result.token, name: result.name ?? "New key" });
				setOpen(false);
			} else {
				toast.error(result.error ?? "Failed to create key");
			}
		});
	}

	return (
		<>
			{issued && (
				<IssuedKey token={issued.token} name={issued.name} onDone={() => setIssued(null)} />
			)}

			{open ? (
				<form
					action={submit}
					className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-5"
				>
					<label className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">Name</span>
						<input
							name="name"
							placeholder="production agent"
							className="w-56 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
						/>
					</label>
					<button
						type="submit"
						disabled={pending}
						className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm disabled:opacity-60"
					>
						{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
						{pending ? "Creating" : "Create key"}
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="rounded-md px-3 py-2 text-muted-foreground text-sm hover:text-foreground"
					>
						Cancel
					</button>
				</form>
			) : (
				<button
					type="button"
					onClick={() => setOpen(true)}
					disabled={atLimit}
					className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					title={atLimit ? "Key limit reached — revoke one first" : undefined}
				>
					<Plus className="size-4" />
					New key
				</button>
			)}
		</>
	);
}

/**
 * The one and only time this token is visible.
 *
 * Deliberately blocking and deliberately loud: only the hash is stored, so a user who
 * navigates away without copying has permanently lost the key. The dismiss button says
 * what dismissing costs rather than being a neutral "Close".
 */
function IssuedKey({ token, name, onDone }: { token: string; name: string; onDone: () => void }) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		await navigator.clipboard.writeText(token);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-6">
			<div className="w-full max-w-2xl rounded-xl border border-border bg-card p-7">
				<div className="mb-4 flex items-center gap-3">
					<TriangleAlert className="size-5 text-warning" />
					<h2 className="font-medium text-base">Copy your key now</h2>
				</div>
				<p className="mb-5 text-muted-foreground text-sm">
					<span className="text-foreground">{name}</span> is shown once. blaze stores only a hash,
					so this value cannot be recovered — if you lose it you will need to create a new key.
				</p>
				<div className="flex items-center gap-3 rounded-lg border border-border bg-background p-4">
					<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[13px]">
						{token}
					</code>
					<button
						type="button"
						onClick={copy}
						className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
					>
						{copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
				<div className="mt-6 flex justify-end">
					<button
						type="button"
						onClick={onDone}
						className="rounded-lg border border-border px-4 py-2.5 text-sm transition-colors hover:bg-accent"
					>
						I've saved it
					</button>
				</div>
			</div>
		</div>
	);
}

export function RevokeApiKey({ id, name }: { id: string; name: string }) {
	const [pending, start] = useTransition();
	const [confirming, setConfirming] = useState(false);

	function revoke() {
		start(async () => {
			const result = await revokeApiKeyAction(id);
			if (result.ok) toast.success(`Revoked ${name}`);
			else toast.error(result.error ?? "Failed to revoke");
			setConfirming(false);
		});
	}

	if (!confirming) {
		return (
			<button
				type="button"
				onClick={() => setConfirming(true)}
				className="text-muted-foreground text-xs transition-colors hover:text-destructive"
			>
				Revoke
			</button>
		);
	}

	return (
		<span className="flex items-center gap-2 text-xs">
			<span className="text-muted-foreground">Anything using it stops working.</span>
			<button
				type="button"
				onClick={revoke}
				disabled={pending}
				className="font-medium text-destructive disabled:opacity-60"
			>
				{pending ? "Revoking" : "Revoke"}
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
