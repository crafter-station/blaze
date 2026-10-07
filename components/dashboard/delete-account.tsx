"use client";

import { useClerk } from "@clerk/nextjs";
import { Loader2, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteAccountAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Typed confirmation rather than a yes/no.
 *
 * This drops every database the account owns, permanently and without a backup to restore
 * from. Retyping your own email is proportionate to deleting all of them, and it is the
 * standard pattern precisely because people recognise what it means.
 */
export function DeleteAccount({ email, databaseCount }: { email: string; databaseCount: number }) {
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("");
	const { signOut } = useClerk();

	const matches = value.trim().toLowerCase() === email.toLowerCase();

	function submit(event: React.FormEvent) {
		event.preventDefault();
		if (!matches) return;
		start(async () => {
			const result = await deleteAccountAction(value);
			if (result.ok) {
				toast.success(
					result.databasesDropped
						? `Account deleted. ${result.databasesDropped} database(s) dropped.`
						: "Account deleted",
				);
				await signOut({ redirectUrl: "/" });
			} else {
				toast.error(result.error ?? "Failed to delete account");
			}
		});
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (pending) return;
				setOpen(next);
				if (!next) setValue("");
			}}
		>
			<DialogTrigger asChild>
				<Button variant="destructive-outline">Delete account</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<span className="mb-1 flex size-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
						<TriangleAlert className="size-4 text-destructive" />
					</span>
					<DialogTitle>Delete your account</DialogTitle>
					<DialogDescription>
						{databaseCount > 0 ? (
							<>
								All <span className="text-foreground">{databaseCount}</span> of your databases will
								be dropped along with their data. There are no backups to restore from.
							</>
						) : (
							<>Your account and API keys will be permanently removed.</>
						)}
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="grid gap-5">
					<div className="grid gap-2">
						<Label htmlFor="confirm-email" className="font-normal text-muted-foreground">
							Type <span className="font-medium font-mono text-foreground">{email}</span> to confirm
						</Label>
						<Input
							id="confirm-email"
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder={email}
							autoComplete="off"
							className="font-mono"
						/>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="ghost" disabled={pending}>
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" variant="destructive" disabled={!matches || pending}>
							{pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
							{pending ? "Deleting" : "Delete everything"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
