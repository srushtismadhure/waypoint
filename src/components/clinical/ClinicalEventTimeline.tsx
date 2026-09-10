import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClinicalEvent, ClinicalEventKind } from "@/lib/respiratory-trends";

const KIND_LABELS: Record<ClinicalEventKind, string> = {
  exacerbation: "Exacerbation",
  admission: "Admission",
  discharge: "Discharge",
  "home-health": "Home health",
  ambulatory: "Ambulatory",
  finding: "Finding",
  task: "Task",
  referral: "Referral",
};

const KIND_VARIANTS: Record<ClinicalEventKind, "warning" | "info" | "success" | "neutral"> = {
  exacerbation: "warning",
  admission: "warning",
  discharge: "info",
  "home-health": "info",
  ambulatory: "info",
  finding: "warning",
  task: "neutral",
  referral: "success",
};

export function ClinicalEventTimeline({ events }: { events: ClinicalEvent[] }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-sm text-[color:var(--brand)]">Clinical Events</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-[color:var(--muted-foreground)]">No dated COPD care events are recorded for this patient.</p>
        ) : (
          <ol className="space-y-3">
            {events.map(event => (
              <li key={`${event.resource}-${event.date}-${event.kind}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--border)] pb-3 text-sm last:border-0 last:pb-0">
                <span className="w-24 shrink-0 font-medium text-[color:var(--foreground)]">{event.date}</span>
                <Badge variant={KIND_VARIANTS[event.kind]}>{KIND_LABELS[event.kind]}</Badge>
                <span className="text-[color:var(--foreground)]">{event.label}</span>
                {event.detail && <span className="text-xs text-[color:var(--muted-foreground)]">{event.detail}</span>}
                <span className="ml-auto text-xs text-[color:var(--muted-foreground)]">{event.resource}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
