import type { PatientCarePathway } from "./types.js";

function serviceText(request: fhir4.ServiceRequest): string {
  return `${request.code?.text ?? ""} ${request.code?.coding?.map(code => `${code.display ?? ""} ${code.code ?? ""}`).join(" ") ?? ""}`.trim();
}

function isCopdRelevant(text: string): boolean {
  return /pulmonary|respirat|copd|home health|home-health|primary care|follow.?up|rehab/i.test(text) && !/kidney|renal|dialysis|transplant|lupus/i.test(text);
}

function patientStatus(status: fhir4.ServiceRequest["status"]): string {
  if (status === "active") return "In progress";
  if (status === "draft") return "Being prepared";
  if (status === "on-hold") return "On hold";
  if (status === "completed") return "Completed";
  if (status === "revoked") return "Cancelled";
  return "Care-team update available";
}

export function normalizeCarePlan(carePlans: fhir4.CarePlan[], serviceRequests: fhir4.ServiceRequest[]): PatientCarePathway[] {
  const servicePathways = serviceRequests
    .filter(request => request.status !== "entered-in-error" && isCopdRelevant(serviceText(request)))
    .map(request => {
      const title = serviceText(request) || "COPD care follow-up";
      const performer = request.performer?.map(item => item.display).filter(Boolean).join(", ");
      const dueDate = request.occurrenceDateTime ?? request.occurrencePeriod?.start;
      return {
        id: request.id ?? `service-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        title,
        purpose: /rehab/i.test(title)
          ? "Support your recovery, breathing, strength, and confidence through pulmonary rehabilitation when ordered by your care team."
          : /home health/i.test(title)
            ? "Coordinate home-health follow-up after discharge and share confirmed findings with your care team."
            : "Coordinate a COPD-related referral or follow-up step documented by your care team.",
        status: request.status,
        statusLabel: patientStatus(request.status),
        nextStep: request.status === "completed" ? "No additional step is listed for this request." : request.status === "draft" ? "Your care team is preparing this request." : "Follow the scheduling or care instructions provided by your care team.",
        responsibleParty: request.requester?.display ?? "Care team",
        patientAction: request.status === "active" ? "Check your appointments and messages for scheduling details." : undefined,
        dueDate,
        destination: performer || undefined,
        milestones: [
          { label: "Request documented", completed: request.status !== "draft" },
          { label: "Care step completed", completed: request.status === "completed" },
        ],
        barriers: [],
      } satisfies PatientCarePathway;
    });

  const planPathways = carePlans
    .filter(plan => plan.status !== "entered-in-error" && isCopdRelevant(`${plan.title ?? ""} ${plan.description ?? ""}`))
    .map(plan => ({
      id: plan.id ?? `care-plan-${plan.title ?? "copd"}`,
      title: plan.title ?? "COPD care plan",
      purpose: plan.description ?? "Coordinate the COPD care steps documented by your care team.",
      status: plan.status,
      statusLabel: plan.status === "active" ? "In progress" : plan.status === "completed" ? "Completed" : "Care-team update available",
      nextStep: plan.activity?.find(activity => activity.detail?.status !== "completed")?.detail?.description ?? "Review this plan with your care team.",
      responsibleParty: plan.author?.display ?? "Care team",
      patientAction: plan.status === "active" ? "Review your appointments, medicines, and messages for the next documented step." : undefined,
      dueDate: plan.period?.end,
      milestones: (plan.activity ?? []).slice(0, 6).map((activity, index) => ({
        label: activity.detail?.description ?? activity.detail?.code?.text ?? `Care-plan step ${index + 1}`,
        completed: activity.detail?.status === "completed",
      })),
      barriers: [],
    } satisfies PatientCarePathway));

  const byId = new Map<string, PatientCarePathway>();
  for (const pathway of [...servicePathways, ...planPathways]) byId.set(pathway.id, pathway);
  return [...byId.values()];
}
