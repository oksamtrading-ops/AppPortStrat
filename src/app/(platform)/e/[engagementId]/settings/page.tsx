import Link from "next/link";
import { requireEngagementContext } from "@/lib/auth/context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAiEnabled, updateEngagementSettings } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Engagement settings (Lead-only): the front door for everything
 * configurable, and the one place engagement details can be edited after
 * creation. Methodology configuration keeps its dedicated pages.
 */
export default async function EngagementSettingsPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, session, engagement } = await requireEngagementContext(engagementId, "ENGAGEMENT_LEAD");
  const base = `/e/${engagementId}`;
  const readOnly = ctx.readOnly;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Engagement settings</h1>
        <p className="text-muted-foreground text-sm">Details, methodology configuration, and team access in one place.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Engagement details</CardTitle>
          <CardDescription>
            {readOnly
              ? `This engagement is read-only (${engagement.status.toLowerCase()}) — details cannot be changed.`
              : session?.mode === "clerk"
                ? "Renaming the engagement also renames its Clerk organization. Changes are audited."
                : "Changes are audited."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateEngagementSettings} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <input type="hidden" name="engagementId" value={engagementId} />
            <div className="space-y-1">
              <Label htmlFor="name">Engagement name</Label>
              <Input id="name" name="name" required maxLength={200} defaultValue={engagement.name} disabled={readOnly} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="clientName">Client</Label>
              <Input id="clientName" name="clientName" required maxLength={200} defaultValue={engagement.clientName} disabled={readOnly} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency (ISO code)</Label>
              <Input id="currency" name="currency" required minLength={3} maxLength={3} defaultValue={engagement.currency} disabled={readOnly} className="uppercase" />
              <p className="text-muted-foreground text-xs">Formats every money figure on Financials, the dashboard, and exports.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fiscalYearConvention">Fiscal year convention</Label>
              <Input id="fiscalYearConvention" name="fiscalYearConvention" required maxLength={20} defaultValue={engagement.fiscalYearConvention} disabled={readOnly} />
            </div>
            {readOnly ? null : (
              <div className="md:col-span-2">
                <Button type="submit">Save details</Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI features</CardTitle>
          <CardDescription>
            Opt-in per engagement. When enabled, this engagement&apos;s computed figures (never raw survey text) are
            sent to the Claude API to generate narratives — confirm the engagement letter permits it. All
            generations are rate-limited and audited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateAiEnabled} className="flex items-center gap-3">
            <input type="hidden" name="engagementId" value={engagementId} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="aiEnabled" defaultChecked={engagement.aiEnabled} disabled={readOnly} />
              Enable AI narratives (dashboard explanation, engagement brief)
            </label>
            {readOnly ? null : (
              <Button type="submit" size="sm" variant="outline">
                Save
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Methodology & team</CardTitle>
          <CardDescription>Configuration that shapes scoring, dispositions, and access.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(
              [
                ["Weightings", `${base}/config/weightings`, "Question importance ratings that derive the score weights."],
                ["Thresholds", `${base}/config/thresholds`, "Disposition boundaries, urgent flags, heat-map thresholds, and strict workbook scoring."],
                ["Option lists", `${base}/config/options`, "Configurable dropdown values (application types, action plans…)."],
                ["Members", `${base}/members`, "Team roster, roles, and client respondent assignments."],
                ["Audit log", `${base}/audit`, "Every configuration change, override, and lifecycle event."],
              ] as const
            ).map(([label, href, desc]) => (
              <li key={href} className="flex items-baseline justify-between gap-4">
                <div>
                  <Link href={href} className="font-medium underline-offset-2 hover:underline">
                    {label}
                  </Link>
                  <span className="text-muted-foreground"> — {desc}</span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
