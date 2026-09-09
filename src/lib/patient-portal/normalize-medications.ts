import type { PatientMedication } from "./types.js";

function medicationName(request: fhir4.MedicationRequest): string {
  if (request.medicationCodeableConcept?.text) return request.medicationCodeableConcept.text;
  return request.medicationCodeableConcept?.coding?.map(code => code.display ?? code.code).filter(Boolean).join(", ") || "Medication";
}

function dosageSummary(request: fhir4.MedicationRequest): { dose?: string; route?: string; frequency?: string } {
  const instruction = request.dosageInstruction?.[0];
  const dose = instruction?.doseAndRate?.[0]?.doseQuantity;
  const timing = instruction?.timing?.repeat;
  return {
    dose: dose?.value !== undefined ? `${dose.value}${dose.unit ? ` ${dose.unit}` : ""}` : undefined,
    route: instruction?.route?.text ?? instruction?.route?.coding?.[0]?.display,
    frequency: instruction?.text ?? (timing?.frequency && timing.period ? `${timing.frequency} time(s) every ${timing.period} ${timing.periodUnit ?? ""}`.trim() : undefined),
  };
}

export function normalizeMedications(requests: fhir4.MedicationRequest[], statements: fhir4.MedicationStatement[] = []): PatientMedication[] {
  return requests
    .filter(request => request.status !== "entered-in-error")
    .map(request => {
      const summary = dosageSummary(request);
      const name = medicationName(request);
      const statement = statements.find(item => {
        const text = item.medicationCodeableConcept?.text ?? item.medicationCodeableConcept?.coding?.map(code => code.display ?? "").join(" ") ?? "";
        return text && name.toLowerCase().includes(text.toLowerCase());
      });
      return {
        id: request.id ?? crypto.randomUUID(),
        name,
        status: request.status,
        dose: summary.dose,
        route: summary.route,
        frequency: summary.frequency,
        reason: request.reasonCode?.map(reason => reason.text).filter(Boolean).join(", ") || undefined,
        prescriber: request.requester?.display,
        startDate: request.authoredOn,
        monitoring: [],
        recentlyChanged: Boolean(request.authoredOn && Date.now() - new Date(request.authoredOn).getTime() <= 90 * 86_400_000),
        refillStatus: statement?.status === "not-taken" ? "Patient reported not taking" : undefined,
      } satisfies PatientMedication;
    })
    .sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return a.name.localeCompare(b.name);
    });
}
