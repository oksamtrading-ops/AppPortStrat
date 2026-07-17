import { requireEngagementContext } from "@/lib/auth/context";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { db } = await requireEngagementContext(engagementId, "CONSULTANT");

  const events = await db.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          Append-only record of configuration and data changes (latest 100 shown).
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
              </TableCell>
              <TableCell>{e.actorDisplay}</TableCell>
              <TableCell className="font-mono text-xs">{e.action}</TableCell>
              <TableCell className="text-muted-foreground text-xs">{e.entityType}</TableCell>
              <TableCell className="text-muted-foreground max-w-md truncate text-xs">
                {e.after ? JSON.stringify(e.after) : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
