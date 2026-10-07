import { Waitlist } from "@clerk/nextjs";
import { AuthShell, embeddedAuthAppearance } from "@/components/marketing/auth-shell";

export const metadata = {
	title: "Join the waitlist",
	description: "blaze is in private alpha. Leave your email and get an invite.",
};

/** The landing page CTA lands here. Public in proxy.ts; Clerk stores the entries. */
export default function WaitlistPage() {
	return (
		<AuthShell
			title="Join the waitlist"
			description="blaze is in private alpha and lets people in a few at a time. Leave your email and you will get an invite."
		>
			<Waitlist appearance={embeddedAuthAppearance} afterJoinWaitlistUrl="/" />
		</AuthShell>
	);
}
