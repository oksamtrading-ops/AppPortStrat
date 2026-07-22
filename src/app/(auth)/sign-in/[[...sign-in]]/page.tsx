import { SignIn } from "@clerk/nextjs";
import { getAuthMode } from "@/lib/auth/mode";
import { DEV_USERS } from "@/lib/auth/dev-users";
import { switchDevUser } from "@/lib/auth/dev-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const mode = getAuthMode();

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-6">
      {mode === "clerk" ? (
        <SignIn />
      ) : (
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>
              APS Platform <span className="text-brand">·</span> Dev sign-in
            </CardTitle>
            <CardDescription>
              Local development mode (no Clerk keys configured). Pick an identity — each maps to a seeded
              membership with a different role.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {DEV_USERS.map((user) => (
              <form key={user.id} action={switchDevUser}>
                <input type="hidden" name="userId" value={user.id} />
                <Button type="submit" variant="outline" className="w-full justify-between">
                  <span>{user.displayName}</span>
                  <span className="text-muted-foreground text-xs">{user.email}</span>
                </Button>
              </form>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
