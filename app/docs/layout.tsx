import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { LayoutGrid, Sparkles } from "lucide-react";
import { siGithub } from "simple-icons";
import { Logo } from "@/components/brand/logo";
import { source } from "@/lib/source";

/**
 * Docs shell (Fumadocs): section sidebar on the left, "On this page" on the right,
 * Cmd/Ctrl+K search, our wordmark and tokens. The root layout already provides
 * next-themes, so Fumadocs' own theme provider is switched off and its toggle drives ours.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<RootProvider theme={{ enabled: false }} search={{ options: { api: "/docs/api/search" } }}>
			<DocsLayout
				tree={source.getPageTree()}
				nav={{
					title: (
						<span className="flex items-center gap-2">
							<Logo size="sm" />
							<span className="rounded-sm border border-border px-1.5 py-px font-medium text-[0.6875rem] text-muted-foreground">
								Docs
							</span>
						</span>
					),
					url: "/",
				}}
				links={[
					{ text: "Console", url: "/projects", icon: <LayoutGrid /> },
					{ text: "Join the waitlist", url: "/waitlist", icon: <Sparkles /> },
					{
						type: "icon",
						text: "GitHub",
						label: "GitHub",
						url: "https://github.com/crafter-station/blaze",
						icon: <GithubMark />,
						external: true,
					},
				]}
			>
				{children}
			</DocsLayout>
		</RootProvider>
	);
}

function GithubMark() {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d={siGithub.path} />
		</svg>
	);
}
