import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { getAuthMode } from "@/lib/auth/mode";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  const mode = getAuthMode();

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-6">
      {mode === "clerk" ? (
        <SignUp />
      ) : (
        <p className="text-muted-foreground">
          Dev mode has fixed identities —{" "}
          <Link className="underline" href="/sign-in">
            pick one on the sign-in page
          </Link>
          .
        </p>
      )}
    </main>
  );
}
