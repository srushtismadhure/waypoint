import type { LucideIcon } from "lucide-react";
import { CalendarDays, CircleHelp, ClipboardList, FileText, House, MessageCircle, Pill, Users, Wind } from "lucide-react";

export interface PortalNavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const PORTAL_NAVIGATION: PortalNavigationItem[] = [
  { to: "/portal", label: "Home", icon: House, end: true },
  { to: "/portal/copd", label: "Breathing & COPD", icon: Wind },
  { to: "/portal/care-plan", label: "My Care Plan", icon: ClipboardList },
  { to: "/portal/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/portal/medications", label: "Medications", icon: Pill },
  { to: "/portal/messages", label: "Messages", icon: MessageCircle },
  { to: "/portal/care-team", label: "My Care Team", icon: Users },
  { to: "/portal/documents", label: "Documents", icon: FileText },
  { to: "/portal/help", label: "Help", icon: CircleHelp },
];
