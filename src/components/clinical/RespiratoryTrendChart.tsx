import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MetricSeries } from "@/lib/respiratory-trends";

const AXIS_TICK = { fontSize: 12, fill: "var(--muted-foreground)" };

function TrendTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: { date: string; value: number; sourceLabel: string } }[]; unit: string }) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div className="rounded-md border border-[var(--info-border)] bg-[var(--card)] px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-[color:var(--foreground)]">{point.date}</p>
      <p className="text-[color:var(--foreground)]">
        {point.value} {unit}
      </p>
      <p className="text-[color:var(--muted-foreground)]">Source: {point.sourceLabel}</p>
    </div>
  );
}

export function RespiratoryTrendChart({ series, variant = "line" }: { series: MetricSeries; variant?: "line" | "bar" }) {
  const { definition, points } = series;

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-sm text-[color:var(--brand)]">{definition.title}</CardTitle>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          {definition.unit}
          {definition.axisHint ? ` · ${definition.axisHint}` : ""}
          {definition.helpText ? ` · ${definition.helpText}` : ""}
        </p>
      </CardHeader>
      <CardContent>
        {points.length === 0 && <p className="text-sm text-[color:var(--muted-foreground)]">No {definition.title.toLowerCase()} observations are recorded for this patient.</p>}
        {points.length === 1 && <p className="text-sm text-[color:var(--muted-foreground)]">Not enough longitudinal data yet — one measurement on {points[0]!.date} from {points[0]!.sourceLabel}.</p>}
        {points.length > 1 && (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {variant === "bar" ? (
                <BarChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "var(--info-bg)" }} content={<TrendTooltip unit={definition.unit} />} />
                  <Bar dataKey="value" name={definition.title} fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} domain={["auto", "auto"]} />
                  <Tooltip content={<TrendTooltip unit={definition.unit} />} />
                  <Line type="monotone" dataKey="value" name={definition.title} stroke="var(--chart-1)" strokeWidth={2} dot />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
