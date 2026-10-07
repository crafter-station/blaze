"use client";

import { Check, ChevronDown, Copy, Loader2, Plus, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions";
import { CopyButton } from "@/components/copy-button";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setupPrompt } from "@/lib/setup-prompt";
import { cn } from "@/lib/utils";

export function CreateApiKey({ atLimit }: { atLimit: boolean }) {
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);
	const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);

	function submit(formData: FormData) {
		start(async () => {
			const result = await createApiKeyAction(formData);
			if (result.ok && result.token) {
				setOpen(false);
				setIssued({ token: result.token, name: result.name ?? "New key" });
			} else {
				toast.error(result.error ?? "Failed to create key");
			}
		});
	}

	const trigger = (
		<Button disabled={atLimit}>
			<Plus data-icon="inline-start" />
			New key
		</Button>
	);

	return (
		<>
			{issued && (
				<IssuedKey token={issued.token} name={issued.name} onDone={() => setIssued(null)} />
			)}

			{atLimit ? (
				<Tooltip>
					<TooltipTrigger asChild>
						{/* biome-ignore lint/a11y/noNoninteractiveTabindex: a disabled button cannot take focus, so the wrapper carries the explanation for keyboard users. */}
						<span tabIndex={0} className="rounded-md">
							{trigger}
						</span>
					</TooltipTrigger>
					<TooltipContent>Key limit reached. Revoke one first.</TooltipContent>
				</Tooltip>
			) : (
				<Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
					<DialogTrigger asChild>{trigger}</DialogTrigger>
					<DialogContent className="sm:max-w-md">
						<DialogHeader>
							<DialogTitle>New API key</DialogTitle>
							<DialogDescription>
								Keys act as you and reach every database you own. Name it after where it will live.
							</DialogDescription>
						</DialogHeader>
						<form action={submit} className="grid gap-5">
							<div className="grid gap-2">
								<Label htmlFor="key-name">Name</Label>
								<Input
									id="key-name"
									name="name"
									placeholder="production agent"
									autoComplete="off"
									autoFocus
								/>
							</div>
							<DialogFooter>
								<DialogClose asChild>
									<Button type="button" variant="ghost" disabled={pending}>
										Cancel
									</Button>
								</DialogClose>
								<Button type="submit" disabled={pending}>
									{pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
									{pending ? "Creating" : "Create key"}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}

/**
 * The one and only time this token is visible.
 *
 * Deliberately blocking: only the hash is stored, so a user who dismisses this without
 * copying has permanently lost the key. Outside clicks and Escape do nothing, and the
 * only exit says what leaving costs rather than being a neutral "Close".
 */
function IssuedKey({ token, name, onDone }: { token: string; name: string; onDone: () => void }) {
	const [copied, setCopied] = useState(false);
	const [showPrompt, setShowPrompt] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {}
	}

	return (
		<Dialog open onOpenChange={() => {}}>
			<DialogContent
				showCloseButton={false}
				onEscapeKeyDown={(event) => event.preventDefault()}
				onPointerDownOutside={(event) => event.preventDefault()}
				onInteractOutside={(event) => event.preventDefault()}
				className="sm:max-w-xl"
			>
				<DialogHeader>
					<span className="mb-1 flex size-9 items-center justify-center rounded-lg border border-warning/25 bg-warning/10">
						<TriangleAlert className="size-4 text-warning" />
					</span>
					<DialogTitle>Copy your key now</DialogTitle>
					<DialogDescription>
						<span className="text-foreground">{name}</span> is shown once. blaze stores only a hash,
						so this value cannot be recovered. If you lose it, create a new key.
					</DialogDescription>
				</DialogHeader>

				<div className="flex h-11 items-center gap-2 rounded-md border border-border bg-background pr-1.5 pl-3 shadow-xs">
					<code className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[0.8125rem]">
						{token}
					</code>
					<Button variant="outline" size="sm" onClick={copy} className="min-w-[76px]">
						{copied ? <Check className="text-success" /> : <Copy />}
						<span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
					</Button>
				</div>

				<div className="overflow-hidden rounded-lg border border-border">
					<button
						type="button"
						onClick={() => setShowPrompt(!showPrompt)}
						aria-expanded={showPrompt}
						className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-muted-foreground text-sm transition-colors hover:bg-accent/60 hover:text-foreground"
					>
						Set this up in your agent with a ready-made prompt
						<ChevronDown
							className={cn("size-4 shrink-0 transition-transform", showPrompt && "rotate-180")}
						/>
					</button>
					{showPrompt && (
						<div className="border-border border-t bg-background">
							<div className="flex justify-end border-border border-b px-2 py-1">
								<CopyButton value={setupPrompt(token)} label="Copy prompt" />
							</div>
							<pre className="max-h-52 overflow-auto whitespace-pre-wrap px-3.5 py-3 text-[0.75rem] text-muted-foreground leading-relaxed">
								{setupPrompt(token)}
							</pre>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button onClick={onDone} variant="outline">
						I have saved it
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function RevokeApiKey({ id, name }: { id: string; name: string }) {
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);

	function revoke(event: React.MouseEvent) {
		event.preventDefault();
		start(async () => {
			const result = await revokeApiKeyAction(id);
			if (result.ok) {
				toast.success(`Revoked ${name}`);
				setOpen(false);
			} else {
				toast.error(result.error ?? "Failed to revoke");
			}
		});
	}

	return (
		<AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
			<AlertDialogTrigger asChild>
				<Button
					variant="ghost"
					size="xs"
					className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
				>
					Revoke
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Revoke {name}?</AlertDialogTitle>
					<AlertDialogDescription>
						Anything using this key gets a 401 from its next request. Databases it created are not
						affected.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={revoke} disabled={pending}>
						{pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
						{pending ? "Revoking" : "Revoke key"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
