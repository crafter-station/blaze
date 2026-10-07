import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/themes";
import type { Metadata, Viewport } from "next";
import { Doto, Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/provider";
import { Toaster } from "@/components/theme/toaster";
import { publicUrl } from "@/lib/public-url";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Display face, used only for the wordmark. Its dot grid is the isotype's grid too. */
const doto = Doto({ variable: "--font-doto", subsets: ["latin"], weight: "700" });

const description =
	"Free managed PostgreSQL, MySQL, MariaDB, MongoDB, Redis and libSQL. Provision from an API, an MCP server, or the dashboard.";

export const metadata: Metadata = {
	metadataBase: new URL(publicUrl()),
	title: {
		default: "blaze · any database in 200ms",
		template: "%s · blaze",
	},
	description,
	applicationName: "blaze",
	icons: {
		icon: [
			{ url: "/favicon.ico", sizes: "32x32" },
			{ url: "/favicon.svg", type: "image/svg+xml", media: "(prefers-color-scheme: light)" },
			{ url: "/favicon-dark.svg", type: "image/svg+xml", media: "(prefers-color-scheme: dark)" },
		],
		apple: "/apple-touch-icon.png",
	},
	manifest: "/site.webmanifest",
	openGraph: {
		type: "website",
		siteName: "blaze",
		title: "blaze · any database in 200ms",
		description,
	},
	twitter: {
		card: "summary_large_image",
		title: "blaze · any database in 200ms",
		description,
	},
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#fafafa" },
		{ media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
	],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		// next-themes writes the class before hydration; the warning it would trigger is
		// expected and limited to this one element.
		<html
			lang="en"
			suppressHydrationWarning
			className={`${geistSans.variable} ${geistMono.variable} ${doto.variable}`}
		>
			<body className="min-h-dvh bg-background font-sans text-foreground antialiased">
				<ThemeProvider>
					<ClerkProvider
						appearance={{
							// The shadcn theme reads our CSS variables directly, so Clerk follows
							// light and dark mode without a second appearance object.
							theme: shadcn,
							variables: {
								fontFamily: "var(--font-geist-sans)",
								borderRadius: "0.5rem",
								colorModalBackdrop: "rgb(0 0 0 / 0.6)",
								// The theme fills inputs with `--input`, which is our border tone and reads
								// as a disabled field in light mode. A recessed well matches our own inputs.
								colorInput: "var(--background)",
							},
							elements: {
								footerActionLink: "!text-brand-text hover:!text-brand-text",
								cardBox: "!shadow-lg !border-border",
								formButtonPrimary: "!font-medium",
								footerAction__signIn: "!text-muted-foreground",
								footerAction__signUp: "!text-muted-foreground",
							},
						}}
					>
						{children}
						<Toaster />
					</ClerkProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
