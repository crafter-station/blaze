import { SignIn } from "@clerk/nextjs";
import { AuthShell, embeddedAuthAppearance } from "@/components/marketing/auth-shell";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
	return (
		<AuthShell
			title="Sign in to blaze"
			description="Welcome back. Your databases are where you left them."
		>
			<SignIn appearance={embeddedAuthAppearance} />
		</AuthShell>
	);
}
