import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import type { Metadata } from "next";
import { Doto, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Display face, used only for the wordmark — the pixel accent from uprizing.me. */
const doto = Doto({ variable: "--font-doto", subsets: ["latin"], weight: ["500", "700"] });

export const metadata: Metadata = {
	title: {
		default: "blaze — any database in 200ms",
		template: "%s · blaze",
	},
	description:
		"Free managed PostgreSQL, MySQL, MariaDB, MongoDB, Redis and libSQL. Provision from an API, an MCP server, or the dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${doto.variable} dark`}>
			<body className="min-h-screen bg-background text-foreground antialiased">
				<ClerkProvider
					appearance={{
						// Clerk 7.7 renamed `baseTheme` to `theme`.
						theme: dark,
						variables: {
							colorPrimary: "#f8f8f8",
							colorBackground: "#0b0b0b",
							borderRadius: "0.425rem",
						},
					}}
				>
					{children}
					<Toaster theme="dark" position="bottom-right" />
				</ClerkProvider>
			</body>
		</html>
	);
}
