import { siMariadb, siMongodb, siMysql, siPostgresql, siRedis, siTurso } from "simple-icons";
import type { Engine } from "@/lib/engines/types";
import { cn } from "@/lib/utils";

/**
 * Engine marks from Simple Icons, drawn in `currentColor`.
 *
 * Monochrome on purpose: six brand colours side by side would out-shout the one accent
 * the interface is allowed. libSQL uses the Turso mark, the project that maintains it.
 */
const ICONS: Record<Engine, { path: string; title: string }> = {
	postgres: siPostgresql,
	mysql: siMysql,
	mariadb: siMariadb,
	mongo: siMongodb,
	redis: siRedis,
	libsql: siTurso,
};

export function EngineIcon({ engine, className }: { engine: Engine; className?: string }) {
	const icon = ICONS[engine];
	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			className={cn("size-4 shrink-0", className)}
			role="img"
			aria-hidden="true"
		>
			<title>{icon.title}</title>
			<path d={icon.path} />
		</svg>
	);
}

/** Engine mark in a small hairline tile, used as a row avatar. */
export function EngineTile({
	engine,
	className,
	size = "md",
}: {
	engine: Engine;
	className?: string;
	size?: "sm" | "md" | "lg";
}) {
	const box = { sm: "size-7", md: "size-8", lg: "size-10" }[size];
	const glyph = { sm: "size-3.5", md: "size-4", lg: "size-5" }[size];
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground/80",
				box,
				className,
			)}
		>
			<EngineIcon engine={engine} className={glyph} />
		</span>
	);
}
