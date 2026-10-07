import { SignUp } from "@clerk/nextjs";
import { AuthShell, embeddedAuthAppearance } from "@/components/marketing/auth-shell";

export const metadata = { title: "Sign up" };

/**
 * Signup is OAuth-only (GitHub and Google), configured in the Clerk dashboard, not here.
 * No password accounts means no disposable-email farming of free databases (PLAN.md Q14).
 */
export default function SignUpPage() {
	return (
		<AuthShell
			title="Create your account"
			description="Continue with GitHub or Google. Your first database is about 200 milliseconds away."
		>
			<SignUp appearance={embeddedAuthAppearance} />
		</AuthShell>
	);
}
