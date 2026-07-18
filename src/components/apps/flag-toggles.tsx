"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { toggleApplicationFlag } from "@/app/(platform)/e/[engagementId]/applications/actions";

const FLAGS = [
  ["inScope", "Scope"],
  ["isUtilized", "Util"],
  ["isReplaced", "Repl"],
  ["inFlight", "Flight"],
] as const;

export function FlagToggles({
  engagementId,
  applicationId,
  values,
  disabled,
}: {
  engagementId: string;
  applicationId: string;
  values: { inScope: boolean; isUtilized: boolean; isReplaced: boolean; inFlight: boolean };
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(flag: (typeof FLAGS)[number][0], value: boolean) {
    startTransition(async () => {
      try {
        await toggleApplicationFlag({ engagementId, applicationId, flag, value });
        router.refresh();
      } catch {
        toast.error("Could not update the flag");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      {FLAGS.map(([flag, label]) => (
        <label key={flag} className="flex flex-col items-center gap-0.5 text-[10px] text-muted-foreground">
          <Switch
            checked={values[flag]}
            disabled={disabled || isPending}
            onCheckedChange={(checked) => toggle(flag, checked)}
            className="scale-75"
          />
          {label}
        </label>
      ))}
    </div>
  );
}
