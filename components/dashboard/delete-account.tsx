"use client";

import { useClerk } from "@clerk/nextjs";
import { Loader2, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteAccountAction } from "@/app/actions";

/**
 * Typed confirmation rather than a yes/no.
 *
 * This drops every database the account owns, permanently and without a backup to restore
 * from. A click-through confirm is proportionate to deleting one database; making someone
 * retype their own email is proportionate to deleting all of them, and it is the standard
 * pattern precisely because people recognise what it means.
 */
export function DeleteAccount({ email, databaseCount }: { email: string; databaseCount: number }) {
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("");
	const { signOut } = useClerk();

	const matches = value.trim().toLowerCase() === email.toLowerCase();

	function submit() {
		start(async () => {
			const result = await deleteAccountAction(value);
			if (result.ok) {
				toast.success(
					result.databasesDropped
						? `Account deleted — ${result.databasesDropped} database(s) dropped`
						: "Account deleted",
				);
				await signOut({ redirectUrl: "/" });
			} else {
				toast.error(result.error ?? "Failed to delete account");
			}
		});
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="rounded-lg border border-destructive/40 px-4 py-2.5 text-destructive text-sm transition-colors hover:bg-destructive/10"
			>
				Delete account
			</button>
		);
	}

	return (
		<div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
			<div className="mb-3 flex items-center gap-2.5">
				<TriangleAlert className="size-4 text-destructive" />
				<p className="font-medium text-sm">This cannot be undone</p>
			</div>
			<p className="mb-4 text-muted-foreground text-sm">
				{databaseCount > 0 ? (
					<>
						All <span className="text-foreground">{databaseCount}</span> of your databases will be
						dropped along with their data. There are no backups to restore from.
					</>
				) : (
					<>Your account and API keys will be permanently removed.</>
				)}{" "}
				Type <span className="font-mono text-foreground">{email}</span> to confirm.
			</p>
			<div className="flex flex-wrap items-center gap-3">
				<input
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={email}
					className="w-72 rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:border-destructive"
				/>
				<button
					type="button"
					onClick={submit}
					disabled={!matches || pending}
					className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2.5 font-medium text-background text-sm disabled:cursor-not-allowed disabled:opacity-40"
				>
					{pending && <Loader2 className="size-4 animate-spin" />}
					{pending ? "Deleting" : "Delete everything"}
				</button>
				<button
					type="button"
					onClick={() => {
						setOpen(false);
						setValue("");
					}}
					className="text-muted-foreground text-sm hover:text-foreground"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
