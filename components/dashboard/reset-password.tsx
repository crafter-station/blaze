"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { resetPasswordAction } from "@/app/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * Rotating a password silently breaks every deployed app still holding the old one, so
 * the confirmation states that consequence rather than asking a bare "are you sure?".
 */
export function ResetPassword({ id }: { id: string }) {
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);

	function reset(event: React.MouseEvent) {
		event.preventDefault();
		start(async () => {
			const result = await resetPasswordAction(id);
			if (result.ok) {
				toast.success("Password rotated. Copy the new connection string.");
				setOpen(false);
			} else {
				toast.error(result.error ?? "Failed to rotate password");
			}
		});
	}

	return (
		<AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
			<AlertDialogTrigger asChild>
				<Button variant="outline">
					<KeyRound data-icon="inline-start" />
					Reset password
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Rotate the password?</AlertDialogTitle>
					<AlertDialogDescription>
						Apps using the current connection string stop connecting the next time they open a
						connection. Sessions that are already open keep working until they disconnect.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={reset} disabled={pending}>
						{pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
						{pending ? "Rotating" : "Rotate password"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
