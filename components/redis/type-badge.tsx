import { typeBadge, typeLabel } from "@/lib/redis/keys";
import { cn } from "@/lib/utils";

const TOKEN: Record<string, string> = {
	string: "--type-string",
	list: "--type-list",
	hash: "--type-hash",
	set: "--type-set",
	zset: "--type-zset",
	stream: "--type-stream",
	"ReJSON-RL": "--type-json",
};

/** Fixed-width type tag: tinted text on a faint wash of the same hue. */
export function TypeBadge({ type, className }: { type: string; className?: string }) {
	const token = TOKEN[type] ?? "--type-other";
	return (
		<span
			title={typeLabel(type)}
			className={cn(
				"inline-flex h-[18px] w-11 shrink-0 items-center justify-center rounded-[4px] font-medium font-mono text-[0.625rem] tracking-wide",
				className,
			)}
			style={{
				color: `var(${token})`,
				backgroundColor: `color-mix(in oklab, var(${token}) 13%, transparent)`,
			}}
		>
			{typeBadge(type)}
		</span>
	);
}
