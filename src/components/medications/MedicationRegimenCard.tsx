import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MedicationRegimenItem } from "@/lib/medication-types";

function statusBadge(status: string) {
  if (status === "active") return <Badge variant="success">Active</Badge>;
  if (status === "draft") return <Badge variant="info">Draft</Badge>;
  if (status === "on-hold") return <Badge variant="warning">On hold</Badge>;
  if (status === "stopped") return <Badge variant="neutral">Stopped</Badge>;
  return <Badge variant="neutral">{status}</Badge>;
}

function monitoringBadge(status: MedicationRegimenItem["monitoring"][number]["status"]) {
  switch (status) {
    case "current":
      return <Badge variant="success">Current</Badge>;
    case "overdue":
      return <Badge variant="warning">Overdue</Badge>;
    case "unavailable":
      return <Badge variant="neutral">Monitoring unavailable</Badge>;
    default:
      return <Badge variant="neutral">Insufficient information</Badge>;
  }
}

interface MedicationRegimenCardProps {
  item: MedicationRegimenItem;
  canManageOrders: boolean;
  onHold: () => void;
  onStop: () => void;
  onReplace: () => void;
  onSign: () => void;
  onReconcile: () => void;
  onViewEvidence: () => void;
}

export function MedicationRegimenCard({ item, canManageOrders, onHold, onStop, onReplace, onSign, onReconcile, onViewEvidence }: MedicationRegimenCardProps) {
  return (
    <Card className="gap-3">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[color:var(--foreground)]">{item.medicationText}</p>
            {item.genericName && <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">{item.genericName} · {item.medicationClass} · {item.therapyRole}</p>}
            {item.medicationCode && (
              <p className="font-mono text-xs text-[color:var(--muted-foreground)]">
                {item.medicationSystem ?? "code"}: {item.medicationCode}
              </p>
            )}
          </div>
          {statusBadge(item.status)}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[color:var(--muted-foreground)] sm:grid-cols-3">
          <div>
            <dt className="font-medium text-[color:var(--foreground)]">Dose</dt>
            <dd>{item.dose ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--foreground)]">Route</dt>
            <dd>{item.route ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--foreground)]">Frequency</dt>
            <dd>{item.frequency ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--foreground)]">Indication</dt>
            <dd>{item.indication ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--foreground)]">Started</dt>
            <dd>{item.startDate ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--foreground)]">Expected end</dt>
            <dd>{item.expectedEndDate ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--foreground)]">Ordered by</dt>
            <dd>{item.orderingClinician ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--foreground)]">Treatment phase</dt>
            <dd>{item.treatmentPhase ?? "Not available"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--foreground)]">Last reconciliation</dt>
            <dd>{item.lastReconciliationDate ?? "Not available"}</dd>
          </div>
        </dl>

        {item.reconciliationStatus && <div className="rounded-md bg-[var(--background)] px-3 py-2 text-xs"><p className="font-medium text-[color:var(--foreground)]">Reconciliation</p><p className="text-[color:var(--muted-foreground)]">{item.reconciliationStatus === "needs-review" ? item.discrepancyType ?? "Needs clinician review" : item.reconciliationStatus === "reconciled" ? "Patient-reported use reconciles with the order" : "Not yet reviewed"}</p></div>}

        <div className="rounded-md bg-[var(--background)] px-3 py-2 text-xs">
          <p className="font-medium text-[color:var(--foreground)]">Patient-reported use</p>
          <p className="text-[color:var(--muted-foreground)]">
            {item.patientReportedUseText ? `${item.patientReportedUseText}${item.patientReportedUseDate ? ` (${item.patientReportedUseDate})` : ""}` : "No patient-reported medication history is available."}
          </p>
        </div>

        {item.monitoring.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-[color:var(--foreground)]">Monitoring</p>
            <div className="flex flex-wrap gap-2">
              {item.monitoring.map(m => (
                <span key={m.label} className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted-foreground)]">
                  {m.label}: {monitoringBadge(m.status)}
                </span>
              ))}
            </div>
          </div>
        )}

        {item.note && <p className="text-xs text-[color:var(--muted-foreground)]">Note: {item.note}</p>}

        <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
          <Button size="sm" variant="outline" onClick={onViewEvidence}>
            View order
          </Button>
          {canManageOrders && item.status === "draft" && (
            <Button size="sm" onClick={onSign}>
              Sign order
            </Button>
          )}
          {canManageOrders && item.status === "active" && (
            <>
              <Button size="sm" variant="outline" onClick={onHold}>
                Pause
              </Button>
              <Button size="sm" variant="outline" onClick={onStop}>
                Stop
              </Button>
              <Button size="sm" variant="outline" onClick={onReplace}>
                Replace
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={onReconcile}>
            Reconcile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
