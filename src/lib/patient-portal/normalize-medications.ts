import type { MedicationPatientState, MedicationRegimenItem } from "../medication-types.js";
import type { PatientMedication } from "./types.js";

function toPatientMedication(item: MedicationRegimenItem, now: Date): PatientMedication {
  const changedAt = item.startDate ? Date.parse(item.startDate) : Number.NaN;
  const recentlyChanged = Number.isFinite(changedAt) && now.getTime() - changedAt <= 90 * 86_400_000;
  return {
    id: item.id,
    name: item.medicationText,
    genericName: item.genericName,
    medicationClass: item.medicationClass,
    therapyRole: item.therapyRole,
    status: item.status,
    dose: item.dose,
    route: item.route,
    frequency: item.frequency,
    reason: item.indication,
    prescriber: item.orderingClinician,
    startDate: item.startDate,
    monitoring: item.monitoring.map(requirement => ({
      label: requirement.label,
      status: requirement.status,
      lastDate: requirement.lastDate,
    })),
    recentlyChanged,
    reconciliationStatus: item.reconciliationStatus,
    discrepancyType: item.discrepancyType,
  };
}

export function normalizeMedications(state: MedicationPatientState, now = new Date()): PatientMedication[] {
  const active = Object.values(state.regimenByGroup).flat().map(item => toPatientMedication(item, now));
  const inactive = state.inactiveOrders.map(item => toPatientMedication(item, now));
  return [...active, ...inactive].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (b.status === "active" && a.status !== "active") return 1;
    return a.name.localeCompare(b.name);
  });
}

