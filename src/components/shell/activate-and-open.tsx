"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrganizationList } from "@clerk/nextjs";
import { toast } from "sonner";

/**
 * Clerk mode only (must be rendered inside ClerkProvider): activates the
 * engagement's organization in the session BEFORE navigating. The tenancy
 * check requires the session's active org to match the engagement — Clerk
 * does not activate an org automatically, so without this step every entry
 * into a fresh engagement 404s.
 */
export function ActivateAndOpen({
  clerkOrgId,
  href,
  className,
  children,
}: {
  clerkOrgId: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setActive, isLoaded } = useOrganizationList();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function open() {
    if (!isLoaded || busy) return;
    setBusy(true);
    try {
      await setActive({ organization: clerkOrgId });
      router.push(href);
    } catch {
      toast.error("You are not a member of this engagement's organization");
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={open} className={className} disabled={busy} aria-busy={busy}>
      {children}
    </button>
  );
}
