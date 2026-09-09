import type { PatientCareTeamMember } from "./types.js";

function helpText(role: string): string {
  const text = role.toLowerCase();
  if (text.includes("pulmon") || text.includes("respirat")) return "Helps manage your breathing, COPD treatment, and lung-health follow-up.";
  if (text.includes("primary") || text.includes("physician") || text.includes("doctor")) return "Helps coordinate your overall medical care and follow-up after transitions in care.";
  if (text.includes("nurse") || text.includes("home health")) return "Helps with home follow-up, breathing checks, education, medicines, and escalation to your care team.";
  if (text.includes("case") || text.includes("coordinator")) return "Helps organize referrals, appointments, and care-transition next steps.";
  if (text.includes("respiratory therapist") || text.includes("rehab")) return "Supports breathing techniques, exercise, oxygen education, and pulmonary rehabilitation.";
  if (text.includes("pharmac")) return "Helps review inhalers, medicines, refills, and medication questions.";
  return "Participates in your documented COPD care plan.";
}

export function normalizeCareTeamForPortal(careTeams: fhir4.CareTeam[]): PatientCareTeamMember[] {
  const members = careTeams.flatMap(team => (team.participant ?? []).map((participant, index) => {
    const role = participant.role?.[0]?.text ?? participant.role?.[0]?.coding?.[0]?.display ?? "Care team member";
    return {
      id: `${team.id ?? "care-team"}-${participant.member?.reference ?? index}`,
      name: participant.member?.display ?? "Care team member",
      role,
      howTheyHelp: helpText(role),
      currentInvolvement: team.name ? [`Part of ${team.name}`] : [],
      canMessage: true,
    } satisfies PatientCareTeamMember;
  }));
  return members.filter((member, index, all) => all.findIndex(item => item.id === member.id) === index);
}
