import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Building2, ClipboardList, FileText, House, LayoutDashboard, Pill, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import logo from "@/assets/images/logo.png";

type ConnectionStatus = "checking" | "connected" | "error";

function useFhirConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/fhir/Patient?_count=1")
      .then(response => {
        if (!cancelled) setStatus(response.ok ? "connected" : "error");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

export function AppSidebar() {
  const connectionStatus = useFhirConnectionStatus();
  const { user } = useAuth();

  const dashboardHome = user?.role === "nurse" ? "/nurse" : "/clinician";

  // Sidebar is cross-patient navigation only; anything scoped to one patient belongs in PatientSubNav.
  const navItems = user?.role === "nurse"
    ? [
        { to: "/nurse", label: "Dashboard", icon: LayoutDashboard, enabled: true, end: true },
        { to: "/nurse/visits", label: "Home Health Visits", icon: House, enabled: true, end: false },
        { to: "/nurse/assessments", label: "Assessments", icon: ClipboardList, enabled: true, end: false },
        { to: "/nurse/medication-reconciliation", label: "Medication Reconciliation", icon: Pill, enabled: true, end: false },
        { to: "#", label: "Care Transitions", icon: Building2, enabled: false },
        { to: "#", label: "Tasks", icon: FileText, enabled: false },
      ]
    : [
        { to: dashboardHome, label: "Dashboard", icon: LayoutDashboard, enabled: true, end: true },
        { to: "/patients", label: "Patients", icon: Users, enabled: true, end: false },
        { to: "/medications", label: "Medication Safety", icon: Pill, enabled: true, end: false },
        { to: "/home-health", label: "Home Health", icon: House, enabled: true, end: false },
        { to: "#", label: "Pulmonary Rehab", icon: Building2, enabled: false },
        { to: "#", label: "Tasks", icon: FileText, enabled: false },
      ];

  return (
    <aside className="min-h-screen w-16 shrink-0 self-stretch bg-[var(--brand)] text-[color:var(--sidebar-foreground)] md:w-60">
      <div className="sticky top-0 flex h-screen flex-col justify-between">
        <div>
          <div className="flex items-center justify-center gap-2 px-3 py-5 text-[color:var(--card)] md:justify-start md:px-5">
            <img src={logo} alt="Waypoint" className="size-6" />
            <span className="hidden text-lg font-semibold md:inline">Waypoint</span>
          </div>

          <nav className="mt-2 flex flex-col gap-0.5 px-3">
            {navItems.map(item =>
              item.enabled ? (
                <NavLink
                  key={item.label}
                  to={item.to}
                  end={item.end}
                  aria-label={item.label}
                  title={item.label}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-10 items-center justify-center gap-3 rounded-lg px-2 py-2 text-sm font-medium outline-none transition-colors hover:bg-white/[0.07] focus-visible:ring-[3px] focus-visible:ring-[var(--sky-blue)]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand)] md:min-h-9 md:justify-start md:px-3",
                      isActive ? "bg-[rgba(128,192,240,0.16)] text-[color:var(--card)]" : "bg-transparent text-[color:var(--sidebar-foreground)]",
                    )
                  }
                >
                  <item.icon className="size-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </NavLink>
              ) : (
                <div
                  key={item.label}
                  className="flex min-h-10 cursor-not-allowed items-center justify-center rounded-lg bg-transparent px-2 py-2 text-sm text-[color:var(--sidebar-foreground)]/60 md:min-h-9 md:justify-between md:px-3"
                  title="Coming later"
                >
                  <span className="flex items-center gap-3">
                    <item.icon className="size-4" />
                    <span className="hidden md:inline">{item.label}</span>
                  </span>
                  <span className="hidden text-[10px] uppercase md:inline">Soon</span>
                </div>
              ),
            )}
          </nav>
        </div>

        <div className="border-t border-white/10 px-2 py-4 md:px-5">
          {user && (
            <p className="mb-2 hidden text-xs text-[color:var(--sidebar-foreground)] md:block">
              {user.role === "nurse" ? "RN Care Coordinator" : "Clinician"} · {user.displayName}
            </p>
          )}
          <div className="flex items-center justify-center gap-2 text-xs md:justify-start">
            <span
              className={cn(
                "size-2 rounded-full",
                connectionStatus === "connected" && "bg-[var(--success)]",
                connectionStatus === "error" && "bg-[#C84F5C]",
                connectionStatus === "checking" && "bg-white/30",
              )}
            />
            <span className="hidden text-[color:var(--sidebar-foreground)] md:inline">FHIR data source</span>
          </div>
          <p className="mt-0.5 hidden text-xs font-semibold text-[color:var(--card)] md:block">
            {connectionStatus === "connected" && "Connected"}
            {connectionStatus === "error" && "Disconnected"}
            {connectionStatus === "checking" && "Checking..."}
          </p>
        </div>
      </div>
    </aside>
  );
}
