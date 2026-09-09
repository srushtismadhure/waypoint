import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

export function PatientSubNav({ patientId }: { patientId: string }) {
  const items = [
    { to: `/patients/${patientId}`, label: "Overview", end: true },
    { to: `/patients/${patientId}/medications`, label: "Medications", end: true },
    { to: `/patients/${patientId}/notes-coding`, label: "Clinical Notes", end: true },
    { to: `/patients/${patientId}/tasks`, label: "Tasks", end: true },
    { to: `/patients/${patientId}/fhir-evidence`, label: "FHIR Evidence", end: true },
  ];

  return (
    <nav className="mb-4 flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-1">
      {items.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "inline-flex min-h-8 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive ? "bg-white text-[color:var(--brand)] shadow-sm" : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]",
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
