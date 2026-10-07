import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a console page streams in. Shaped like the page it stands in for (title,
 * a summary strip, a list) so the layout does not jump when the real content lands.
 */
export default function Loading() {
	return (
		<div className="space-y-8" aria-busy="true">
			<span className="sr-only">Loading</span>
			<div className="flex items-end justify-between gap-6">
				<div className="space-y-2.5">
					<Skeleton className="h-7 w-44" />
					<Skeleton className="h-4 w-72 max-w-full" />
				</div>
				<Skeleton className="h-8 w-32" />
			</div>

			<div className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 lg:grid-cols-4">
				{[0, 1, 2, 3].map((index) => (
					<div key={index} className="space-y-2.5 p-5">
						<Skeleton className="h-3.5 w-20" />
						<Skeleton className="h-6 w-24" />
					</div>
				))}
			</div>

			<div className="overflow-hidden rounded-xl border border-border bg-card">
				<div className="border-border border-b px-5 py-4">
					<Skeleton className="h-4 w-28" />
				</div>
				{[0, 1, 2].map((index) => (
					<div
						key={index}
						className="flex items-center gap-3 border-border border-b px-5 py-4 last:border-0"
					>
						<Skeleton className="size-8 rounded-md" />
						<div className="flex-1 space-y-2">
							<Skeleton className="h-3.5 w-40" />
							<Skeleton className="h-3 w-56 max-w-full" />
						</div>
						<Skeleton className="h-3.5 w-16" />
					</div>
				))}
			</div>
		</div>
	);
}
