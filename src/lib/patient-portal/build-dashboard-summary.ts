import type {
  PatientAppointment,
  PatientCarePathway,
  PatientCopdOverview,
  PatientDashboardSummary,
  PatientMedication,
  PatientMessageSummary,
  PatientNextStep,
} from "./types.js";

export function buildDashboardSummary(input: {
  copd: PatientCopdOverview;
  carePlan: PatientCarePathway[];
  appointments: PatientAppointment[];
  medications: PatientMedication[];
  messages: PatientMessageSummary[];
  coordinator: string;
}): PatientDashboardSummary {
  const upcoming = input.appointments.filter(appointment => !appointment.past && appointment.status !== "cancelled");
  const nextAppointment = input.copd.followUp.nextAppointment ?? upcoming[0];
  const activePathways = input.carePlan.filter(pathway => !["completed", "closed", "declined"].includes(pathway.status));
  const nextSteps: PatientNextStep[] = activePathways.slice(0, 3).map(pathway => ({
    id: `pathway-${pathway.id}`,
    title: pathway.nextStep,
    whyItMatters: pathway.purpose,
    responsibleParty: pathway.responsibleParty,
    dueDate: pathway.dueDate,
    patientAction: pathway.patientAction,
    status: pathway.statusLabel,
  }));

  if (nextSteps.length < 3 && input.copd.medicationCheck.status === "Medication issue documented") {
    nextSteps.push({
      id: "medication-check",
      title: "Review your medication list",
      whyItMatters: input.copd.medicationCheck.detail,
      responsibleParty: "You and your care team",
      patientAction: "Use Messages if the medication issue is still unresolved.",
      status: "Needs review",
    });
  }
  if (nextSteps.length < 3 && input.copd.pulmonaryRehab.status === "No active referral documented") {
    nextSteps.push({
      id: "pulmonary-rehab",
      title: "Ask about pulmonary rehabilitation",
      whyItMatters: "Pulmonary rehabilitation can be part of recovery and long-term COPD care after an exacerbation or hospitalization.",
      responsibleParty: "You and your care team",
      patientAction: "Ask whether pulmonary rehabilitation is appropriate for you.",
      status: "Discuss with care team",
    });
  }

  return {
    today: nextSteps.slice(0, 3),
    breathing: {
      spo2: input.copd.respiratory.spo2?.value,
      dyspnea: input.copd.respiratory.dyspnea?.value,
      oxygen: input.copd.respiratory.oxygen?.value,
      status: input.copd.respiratory.breathingComparedWithBaseline?.value
        ? `Breathing compared with usual: ${input.copd.respiratory.breathingComparedWithBaseline.value}`
        : "Review the latest breathing measurements available in your record.",
    },
    homeHealth: {
      status: input.copd.homeHealth.status,
      latestVisitDate: input.copd.homeHealth.latestVisitDate,
    },
    pulmonaryRehab: input.copd.pulmonaryRehab,
    nextAppointment,
    carePlan: {
      activeSteps: activePathways.length,
      nextAction: activePathways[0]?.nextStep ?? "No action is currently listed in your care plan.",
      coordinator: input.coordinator,
    },
    medications: {
      activeCount: input.medications.filter(medication => medication.status === "active").length,
      attentionNote: input.copd.medicationCheck.status === "Medication issue documented" ? input.copd.medicationCheck.detail : undefined,
    },
    messages: {
      unreadCount: 0,
      latestSubject: input.messages[0]?.subject,
    },
  };
}
