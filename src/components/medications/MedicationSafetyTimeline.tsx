import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type RangeOption = "3M" | "6M" | "12M" | "ALL";

const RANGE_DAYS: Record<Exclude<RangeOption, "ALL">, number> = { "3M": 90, "6M": 180, "12M": 365 };

interface TimelineEvent {
  date: string;
  type: "medication-start" | "medication-stop" | "task" | "assessment" | "reconciliation";
  label: string;
  source: string;
}

function withinRange(dateIso: string, range: RangeOption): boolean {
  if (range === "ALL") return true;
  const cutoff = Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
  return Date.parse(dateIso) >= cutoff;
}

const EVENT_LABELS: Record<TimelineEvent["type"], string> = {
  "medication-start": "Medication started",
  "medication-stop": "Medication stopped",
  task: "Task",
  assessment: "Symptom assessment",
  reconciliation: "Reconciliation",
};

export function MedicationSafetyTimeline({ events }: { events: TimelineEvent[] }) {
  const [range, setRange] = useState<RangeOption>("ALL");

  const visibleEvents = useMemo(
    () => events.filter(e => withinRange(e.date, range)).sort((a, b) => b.date.localeCompare(a.date)),
    [events, range],
  );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[color:var(--foreground)]">Medication safety timeline</h2>
        <div className="flex gap-1">
          {(["3M", "6M", "12M", "ALL"] as RangeOption[]).map(option => (
            <Button
              key={option}
              size="sm"
              variant={range === option ? "default" : "outline"}
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {option === "ALL" ? "All" : option}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Medication and care events</CardTitle>
        </CardHeader>
        <CardContent>
          {visibleEvents.length === 0 ? (
            <p className="text-sm text-[color:var(--muted-foreground)]">No dated medication or care events in this range.</p>
          ) : (
            <ul className="space-y-2">
              {visibleEvents.map((event, index) => (
                <li key={`${event.source}-${index}`} className="flex items-center gap-3 border-b border-[var(--border)] pb-2 text-sm last:border-0">
                  <Badge variant="info">{EVENT_LABELS[event.type]}</Badge>
                  <span className="text-[color:var(--foreground)]">{event.label}</span>
                  <span className="ml-auto text-xs text-[color:var(--muted-foreground)]">{event.date}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
        Symptom reported after medication start reflects temporal proximity only. Temporal relationship requires clinician review; medication
        causality is not established by this timeline.
      </p>
    </section>
  );
}

export type { TimelineEvent };
