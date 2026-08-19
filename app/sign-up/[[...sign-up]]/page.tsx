import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Sign up" };

/**
 * Signup is OAuth-only (GitHub and Google) — configured in the Clerk dashboard, not here.
 * No password accounts means no disposable-email farming of free databases (PLAN.md Q14).
 */
export default function SignUpPage() {
	return (
		<main className="flex min-h-screen items-center justify-center p-6">
			<SignUp />
		</main>
	);
}
