"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createDatabaseAction, deleteDatabaseAction } from "@/app/actions";
import { EngineIcon } from "@/components/brand/engine-icon";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

	const trigger = (
		<Button disabled={atQuota}>
			<Plus data-icon="inline-start" />
			New database
		</Button>
	);

	if (atQuota) {
		// A disabled button swallows pointer events, so the explanation hangs off a wrapper.
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: a disabled button cannot take focus, so the wrapper carries the explanation for keyboard users. */}
					<span tabIndex={0} className="rounded-md">
						{trigger}
					</span>
				</TooltipTrigger>
				<TooltipContent>Database limit reached. Delete one first.</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New database</DialogTitle>
					<DialogDescription>
						Provisioned in about 200 milliseconds. The connection string is shown as soon as it is
						ready.
					</DialogDescription>
				</DialogHeader>

				<form action={submit} className="grid gap-5">
					<div className="grid gap-2">
						<Label htmlFor="db-name">Name</Label>
						<Input id="db-name" name="name" placeholder="my-app" autoComplete="off" autoFocus />
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-2">
							<Label htmlFor="db-engine">Engine</Label>
							{/*
							 * Availability comes from the provisioner's own list, never a literal. A
							 * hard-coded "postgres" here is how the dialog kept saying "soon" for
							 * engines that had already shipped.
							 */}
							<Select name="engine" defaultValue="postgres">
								<SelectTrigger id="db-engine" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ENGINES.map((engine) => {
										const live = PROVISIONABLE.includes(engine);
										return (
											<SelectItem key={engine} value={engine} disabled={!live}>
												<EngineIcon engine={engine} className="size-3.5" />
												{ENGINE_CONFIG[engine].label}
												{!live && <span className="text-muted-foreground text-xs">Soon</span>}
											</SelectItem>
										);
									})}
								</SelectContent>
							</Select>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="db-ttl">Auto-delete after</Label>
							<Select name="ttlHours" defaultValue="0">
								<SelectTrigger id="db-ttl" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="0">Never</SelectItem>
									<SelectItem value="1">1 hour</SelectItem>
									<SelectItem value="24">24 hours</SelectItem>
									<SelectItem value="168">7 days</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="ghost" disabled={pending}>
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={pending}>
							{pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
							{pending ? "Provisioning" : "Create database"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function DeleteDatabase({
	id,
	name,
	redirectTo,
	variant = "text",
}: {
	id: string;
	name: string;
	/** Where to go after deleting. The detail page must leave: its record is gone. */
	redirectTo?: string;
	variant?: "text" | "button";
}) {
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);
	const router = useRouter();

	function remove(event: React.MouseEvent) {
		// Keep the dialog open until the server answers, so a failure is seen in context.
		event.preventDefault();
		start(async () => {
			const result = await deleteDatabaseAction(id);
			if (result.ok) {
				toast.success(`Deleted ${name}`);
				setOpen(false);
				if (redirectTo) router.push(redirectTo);
			} else {
				toast.error(result.error ?? "Failed to delete");
			}
		});
	}

	// A confirmation step rather than a one-click action: dropping a database destroys data
	// irreversibly, and a single mis-click should not be enough to do it.
	return (
		<AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
			<AlertDialogTrigger asChild>
				{variant === "button" ? (
					<Button variant="destructive-outline">
						<Trash2 data-icon="inline-start" />
						Delete
					</Button>
				) : (
					<Button
						variant="ghost"
						size="xs"
						className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
					>
						Delete
					</Button>
				)}
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {name}?</AlertDialogTitle>
					<AlertDialogDescription>
						The database and every row in it are dropped permanently. Apps using its connection
						string stop working immediately. There is no undo.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={remove} disabled={pending}>
						{pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
						{pending ? "Deleting" : "Delete permanently"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
