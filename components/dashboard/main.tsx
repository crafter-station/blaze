"use client";

import { usePathname } from "next/navigation";

/**
 * The console's content frame. Pages sit in a centred, padded column; the SQL editor is
 * a workspace and takes the full width and height below the top bar instead.
 */
export function Main({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const workspace = /^\/databases\/[^/]+\/sql\/?$/.test(pathname);

	if (workspace) {
		return (
			<main id="main" className="flex min-w-0 flex-1 flex-col">
				{children}
			</main>
		);
	}

	return (
		<main id="main" className="flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
			<div className="mx-auto max-w-[1120px]">{children}</div>
		</main>
	);
}
