import Link from "next/link";
import { ActivateAndOpen } from "./activate-and-open";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * Opens an engagement workspace. In Clerk mode this first activates the
 * engagement's organization in the session (see ActivateAndOpen); in dev mode
 * it is a plain link.
 */
export function EngagementLink({
  engagementId,
  clerkOrgId,
  className,
  children,
}: {
  engagementId: string;
  clerkOrgId: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const href = `/e/${engagementId}/dashboard`;
  if (clerkEnabled && clerkOrgId) {
    return (
      <ActivateAndOpen clerkOrgId={clerkOrgId} href={href} className={className}>
        {children}
      </ActivateAndOpen>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
