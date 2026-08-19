import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
	return (
		<main className="flex min-h-screen items-center justify-center p-6">
			<SignIn />
		</main>
	);
}
