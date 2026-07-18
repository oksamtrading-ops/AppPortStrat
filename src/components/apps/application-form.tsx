"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CapabilitySelect, type CapabilityNodeOption } from "./capability-select";
import { saveApplication, type ApplicationInput } from "@/app/(platform)/e/[engagementId]/applications/actions";

export interface ApplicationFormValues {
  applicationId?: string;
  name: string;
  acronym: string;
  description: string;
  applicationType: string;
  businessFunctionDetail: string;
  target: string;
  meetsFutureState: "" | "YES" | "NO" | "PARTIAL";
  actionPlanAssignment: string;
  actionPlanJustification: string;
  missionCritical: boolean;
  comments: string;
  inScope: boolean;
  isUtilized: boolean;
  isReplaced: boolean;
  inFlight: boolean;
  capabilityNodeId: string | null;
}

export function ApplicationForm({
  engagementId,
  initial,
  nodes,
  applicationTypes,
  actionPlanOptions,
}: {
  engagementId: string;
  initial: ApplicationFormValues;
  nodes: CapabilityNodeOption[];
  applicationTypes: string[];
  actionPlanOptions: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [flags, setFlags] = useState({
    missionCritical: initial.missionCritical,
    inScope: initial.inScope,
    isUtilized: initial.isUtilized,
    isReplaced: initial.isReplaced,
    inFlight: initial.inFlight,
  });

  function submit(formData: FormData) {
    const text = (key: string) => String(formData.get(key) ?? "");
    const input: ApplicationInput = {
      engagementId,
      applicationId: initial.applicationId,
      name: text("name"),
      acronym: text("acronym") || null,
      description: text("description") || null,
      applicationType: text("applicationType") || null,
      businessFunctionDetail: text("businessFunctionDetail") || null,
      target: text("target") || null,
      meetsFutureState: (text("meetsFutureState") || null) as ApplicationInput["meetsFutureState"],
      actionPlanAssignment: text("actionPlanAssignment") || null,
      actionPlanJustification: text("actionPlanJustification") || null,
      comments: text("comments") || null,
      capabilityNodeId: text("capabilityNodeId") || null,
      ...flags,
    };
    startTransition(async () => {
      try {
        await saveApplication(input);
      } catch (err) {
        // redirect() throws internally on success — only real errors reach a message here
        if (err && typeof err === "object" && "digest" in err) throw err;
        toast.error("Could not save the application");
      }
    });
  }

  const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

  return (
    <form action={submit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="name">Application name *</Label>
            <Input id="name" name="name" required defaultValue={initial.name} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acronym">Acronym</Label>
            <Input id="acronym" name="acronym" defaultValue={initial.acronym} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              name="description"
              defaultValue={initial.description}
              className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="applicationType">Application type</Label>
            {applicationTypes.length > 0 ? (
              <select id="applicationType" name="applicationType" defaultValue={initial.applicationType} className={selectClass}>
                <option value="">—</option>
                {applicationTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <Input id="applicationType" name="applicationType" defaultValue={initial.applicationType} placeholder="Configure values under Option lists" />
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="businessFunctionDetail">Business function detail</Label>
            <Input id="businessFunctionDetail" name="businessFunctionDetail" defaultValue={initial.businessFunctionDetail} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capability mapping</CardTitle>
        </CardHeader>
        <CardContent>
          <CapabilitySelect nodes={nodes} initialNodeId={initial.capabilityNodeId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Planning</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="target">Target</Label>
            <Input id="target" name="target" defaultValue={initial.target} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="meetsFutureState">Meets future-state architecture</Label>
            <select id="meetsFutureState" name="meetsFutureState" defaultValue={initial.meetsFutureState} className={selectClass}>
              <option value="">—</option>
              <option value="YES">Yes</option>
              <option value="NO">No</option>
              <option value="PARTIAL">Partial</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="actionPlanAssignment">Action plan assignment</Label>
            {actionPlanOptions.length > 0 ? (
              <select id="actionPlanAssignment" name="actionPlanAssignment" defaultValue={initial.actionPlanAssignment} className={selectClass}>
                <option value="">—</option>
                {actionPlanOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <Input id="actionPlanAssignment" name="actionPlanAssignment" defaultValue={initial.actionPlanAssignment} />
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="actionPlanJustification">Action plan justification</Label>
            <Input id="actionPlanJustification" name="actionPlanJustification" defaultValue={initial.actionPlanJustification} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="comments">Overall comments</Label>
            <textarea
              id="comments"
              name="comments"
              defaultValue={initial.comments}
              className="min-h-16 w-full rounded-md border bg-background p-2 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scope & criticality</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {(
            [
              ["inScope", "In scope"],
              ["isUtilized", "Utilized"],
              ["isReplaced", "Replaced"],
              ["inFlight", "In flight (in dev)"],
              ["missionCritical", "Mission critical"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <Switch
                id={key}
                checked={flags[key]}
                onCheckedChange={(checked) => setFlags((f) => ({ ...f, [key]: checked }))}
              />
              <Label htmlFor={key}>{label}</Label>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : initial.applicationId ? "Save changes" : "Add application"}
      </Button>
    </form>
  );
}
