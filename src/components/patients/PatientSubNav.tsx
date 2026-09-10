import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const TAB_CLASS = "inline-flex min-h-8 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors";

/** Patient-scoped destinations only. Cross-patient worklists belong in AppSidebar. */
export function PatientSubNav({ patientId }: { patientId: string }) {
  const items = [
    { to: `/patients/${patientId}`, label: "Overview", end: true, enabled: true },
    { to: `/patients/${patientId}/respiratory-trends`, label: "Respiratory Trends", end: true, enabled: true },
    { to: `/patients/${patientId}/medications`, label: "Medications", end: true, enabled: true },
    { to: `/patients/${patientId}/home-health`, label: "Home Health", end: true, enabled: true },
    { to: `/patients/${patientId}/pulmonary-rehab`, label: "Pulmonary Rehab", end: true, enabled: true },
    { to: `/patients/${patientId}/tasks`, label: "Tasks", end: true, enabled: true },
  ];

  return (
    <nav className="mb-4 flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-1">
      {items.map(item =>
        item.enabled ? (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(TAB_CLASS, isActive ? "bg-white text-[color:var(--brand)] shadow-sm" : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]")
            }
          >
            {item.label}
          </NavLink>
        ) : (
          <span key={item.label} className={cn(TAB_CLASS, "cursor-not-allowed gap-2 text-[color:var(--muted-foreground)]/60")} title="Coming later">
            {item.label}
            <span className="text-[10px] uppercase">Soon</span>
          </span>
        ),
      )}
    </nav>
  );
}
