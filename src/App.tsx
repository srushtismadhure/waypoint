import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { NurseDashboardPage } from "@/pages/NurseDashboardPage";
import { HomeHealthVisitsPage } from "@/pages/HomeHealthVisitsPage";
import { HomeHealthVisitPage } from "@/pages/HomeHealthVisitPage";
import { NurseAssessmentsPage } from "@/pages/NurseAssessmentsPage";
import { NurseMedicationReconciliationPage } from "@/pages/NurseMedicationReconciliationPage";
import { OasisAssessmentPage } from "@/pages/OasisAssessmentPage";
import { PatientsPage } from "@/pages/PatientsPage";
import { PatientDashboardPage } from "@/pages/PatientDashboardPage";
import { MedicationManagementPage } from "@/pages/MedicationManagementPage";
import { MedicationsOverviewPage } from "@/pages/MedicationsOverviewPage";
import { NotesCodingPage } from "@/pages/NotesCodingPage";
import { CareCoordinationPage } from "@/pages/CareCoordinationPage";
import { PortalLayout } from "@/components/patient-portal/PortalLayout";
import { PortalHomePage } from "@/pages/patient-portal/PortalHomePage";
import { PortalCopdPage } from "@/pages/patient-portal/PortalCopdPage";
import { PortalCarePlanPage } from "@/pages/patient-portal/PortalCarePlanPage";
import { PortalAppointmentsPage } from "@/pages/patient-portal/PortalAppointmentsPage";
import { PortalMedicationsPage } from "@/pages/patient-portal/PortalMedicationsPage";
import { PortalMessagesPage } from "@/pages/patient-portal/PortalMessagesPage";
import { PortalCareTeamPage } from "@/pages/patient-portal/PortalCareTeamPage";
import { PortalDocumentsPage } from "@/pages/patient-portal/PortalDocumentsPage";
import { PortalProfilePage } from "@/pages/patient-portal/PortalProfilePage";
import { PortalHelpPage } from "@/pages/patient-portal/PortalHelpPage";
import { PortalNotFoundPage } from "@/pages/patient-portal/PortalNotFoundPage";
import "./index.css";

function RoleHome() {
  const { user } = useAuth();
  const destination = user?.role === "patient" ? "/portal" : user?.role === "nurse" ? "/nurse" : "/patients";
  return <Navigate to={destination} replace />;
}

const STAFF_ROLES = ["nurse", "clinician"] as const;

export function App() {
  return <AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<ProtectedRoute><RoleHome /></ProtectedRoute>} />
    <Route path="/dashboard" element={<Navigate to="/clinician" replace />} />
    <Route path="/clinician" element={<ProtectedRoute allowedRoles={["clinician"]}><DashboardPage /></ProtectedRoute>} />
    <Route path="/nurse" element={<ProtectedRoute allowedRoles={["nurse"]}><NurseDashboardPage /></ProtectedRoute>} />
    <Route path="/nurse/visits" element={<ProtectedRoute allowedRoles={["nurse"]}><HomeHealthVisitsPage /></ProtectedRoute>} />
    <Route path="/nurse/visits/:visitId" element={<ProtectedRoute allowedRoles={["nurse"]}><HomeHealthVisitPage /></ProtectedRoute>} />
    <Route path="/nurse/assessments" element={<ProtectedRoute allowedRoles={["nurse"]}><NurseAssessmentsPage /></ProtectedRoute>} />
    <Route path="/nurse/assessments/:patientId/oasis" element={<ProtectedRoute allowedRoles={["nurse"]}><OasisAssessmentPage /></ProtectedRoute>} />
    <Route path="/nurse/medication-reconciliation" element={<ProtectedRoute allowedRoles={["nurse"]}><NurseMedicationReconciliationPage /></ProtectedRoute>} />

    <Route path="/portal" element={<ProtectedRoute allowedRoles={["patient"]}><PortalLayout /></ProtectedRoute>}>
      <Route index element={<PortalHomePage />} />
      <Route path="copd" element={<PortalCopdPage />} />
      <Route path="care-plan" element={<PortalCarePlanPage />} />
      <Route path="appointments" element={<PortalAppointmentsPage />} />
      <Route path="medications" element={<PortalMedicationsPage />} />
      <Route path="messages" element={<PortalMessagesPage />} />
      <Route path="care-team" element={<PortalCareTeamPage />} />
      <Route path="documents" element={<PortalDocumentsPage />} />
      <Route path="profile" element={<PortalProfilePage />} />
      <Route path="help" element={<PortalHelpPage />} />
      <Route path="*" element={<PortalNotFoundPage />} />
    </Route>

    <Route path="/patients" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><PatientsPage /></ProtectedRoute>} />
    <Route path="/overview" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><Navigate to="/patients" replace /></ProtectedRoute>} />
    <Route path="/medications" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><MedicationsOverviewPage /></ProtectedRoute>} />
    <Route path="/patients/:patientId" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><PatientDashboardPage /></ProtectedRoute>} />
    <Route path="/patients/:patientId/medications" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><MedicationManagementPage /></ProtectedRoute>} />
    <Route path="/patients/:patientId/notes-coding" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><NotesCodingPage /></ProtectedRoute>} />
    <Route path="/patients/:patientId/care-coordination" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><CareCoordinationPage /></ProtectedRoute>} />
    <Route path="/patients/:patientId/referrals" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><PatientDashboardPage /></ProtectedRoute>} />
    <Route path="/patients/:patientId/tasks" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><PatientDashboardPage /></ProtectedRoute>} />
    <Route path="/patients/:patientId/fhir-evidence" element={<ProtectedRoute allowedRoles={[...STAFF_ROLES]}><PatientDashboardPage /></ProtectedRoute>} />
  </Routes></AuthProvider>;
}

export default App;
