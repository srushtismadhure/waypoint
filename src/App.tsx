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
import { KidneyServicesPage } from "@/pages/KidneyServicesPage";
import { NotesCodingPage } from "@/pages/NotesCodingPage";
import { RespiratoryTrendsPage } from "@/pages/RespiratoryTrendsPage";
import { ClinicianHomeHealthPage } from "@/pages/ClinicianHomeHealthPage";
import { HomeHealthWorklistPage } from "@/pages/HomeHealthWorklistPage";
import { PulmonaryRehabPage } from "@/pages/PulmonaryRehabPage";
import { PatientTasksPage } from "@/pages/PatientTasksPage";
import { RenalTrendsPage } from "@/pages/RenalTrendsPage";
import { CareCoordinationPage } from "@/pages/CareCoordinationPage";
import { SleSystemsReviewPage } from "@/pages/SleSystemsReviewPage";
import { PortalLayout } from "@/components/patient-portal/PortalLayout";
import { PortalHomePage } from "@/pages/patient-portal/PortalHomePage";
import { PortalSymptomsBreathingPage } from "@/pages/patient-portal/PortalSymptomsBreathingPage";
import { PortalLabsPage } from "@/pages/patient-portal/PortalLabsPage";
import { PortalLabDetailPage } from "@/pages/patient-portal/PortalLabDetailPage";
import { PortalNutritionPage } from "@/pages/patient-portal/PortalNutritionPage";
import { PortalCarePlanPage } from "@/pages/patient-portal/PortalCarePlanPage";
import { PortalAppointmentsPage } from "@/pages/patient-portal/PortalAppointmentsPage";
import { PortalMedicationsPage } from "@/pages/patient-portal/PortalMedicationsPage";
import { PortalMessagesPage } from "@/pages/patient-portal/PortalMessagesPage";
import { PortalCareTeamPage } from "@/pages/patient-portal/PortalCareTeamPage";
import { PortalDocumentsPage } from "@/pages/patient-portal/PortalDocumentsPage";
import { PortalProfilePage } from "@/pages/patient-portal/PortalProfilePage";
import { PortalHelpPage } from "@/pages/patient-portal/PortalHelpPage";
import { PortalHomeHealthPage } from "@/pages/patient-portal/PortalHomeHealthPage";
import { PortalPulmonaryRehabPage } from "@/pages/patient-portal/PortalPulmonaryRehabPage";
import { PortalEducationPage } from "@/pages/patient-portal/PortalEducationPage";
import { PortalNotFoundPage } from "@/pages/patient-portal/PortalNotFoundPage";
import "./index.css";
import { MADISON_GRACE_PATIENT_ID } from "@/lib/madison-class-iv-data";

/** Sends an authenticated user to the dashboard for their demo role. Unauthenticated users fall through to /login via ProtectedRoute. */
function RoleHome() {
  const { user } = useAuth();
  const destination = user?.role === "patient" ? "/portal" : user?.role === "nurse" ? "/nurse" : `/patients/${MADISON_GRACE_PATIENT_ID}`;
  return <Navigate to={destination} replace />;
}

const STAFF_ROLES = ["nurse", "clinician"] as const;

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RoleHome />
            </ProtectedRoute>
          }
        />
        <Route path="/dashboard" element={<Navigate to="/clinician" replace />} />
        <Route
          path="/clinician"
          element={
            <ProtectedRoute allowedRoles={["clinician"]}>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/nurse"
          element={
            <ProtectedRoute allowedRoles={["nurse"]}>
              <NurseDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route path="/nurse/visits" element={<ProtectedRoute allowedRoles={["nurse"]}><HomeHealthVisitsPage /></ProtectedRoute>} />
        <Route path="/nurse/visits/:visitId" element={<ProtectedRoute allowedRoles={["nurse"]}><HomeHealthVisitPage /></ProtectedRoute>} />
        <Route path="/nurse/assessments" element={<ProtectedRoute allowedRoles={["nurse"]}><NurseAssessmentsPage /></ProtectedRoute>} />
        <Route path="/nurse/assessments/:patientId/oasis" element={<ProtectedRoute allowedRoles={["nurse"]}><OasisAssessmentPage /></ProtectedRoute>} />
        <Route path="/nurse/medication-reconciliation" element={<ProtectedRoute allowedRoles={["nurse"]}><NurseMedicationReconciliationPage /></ProtectedRoute>} />
        <Route
          path="/portal"
          element={
            <ProtectedRoute allowedRoles={["patient"]}>
              <PortalLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<PortalHomePage />} />
          <Route path="symptoms-breathing" element={<PortalSymptomsBreathingPage />} />
          <Route path="labs" element={<PortalLabsPage />} />
          <Route path="labs/:resultId" element={<PortalLabDetailPage />} />
          <Route path="nutrition" element={<PortalNutritionPage />} />
          <Route path="care-plan" element={<PortalCarePlanPage />} />
          <Route path="appointments" element={<PortalAppointmentsPage />} />
          <Route path="medications" element={<PortalMedicationsPage />} />
          <Route path="home-health" element={<PortalHomeHealthPage />} />
          <Route path="pulmonary-rehab" element={<PortalPulmonaryRehabPage />} />
          <Route path="education" element={<PortalEducationPage />} />
          <Route path="messages" element={<PortalMessagesPage />} />
          <Route path="care-team" element={<PortalCareTeamPage />} />
          <Route path="documents" element={<PortalDocumentsPage />} />
          <Route path="profile" element={<PortalProfilePage />} />
          <Route path="help" element={<PortalHelpPage />} />
          <Route path="*" element={<PortalNotFoundPage />} />
        </Route>
        <Route
          path="/patients"
          element={
            <ProtectedRoute allowedRoles={["clinician"]}>
              <PatientsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sle-systems-review"
          element={
            <ProtectedRoute allowedRoles={["clinician"]}>
              <SleSystemsReviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/overview"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <Navigate to={`/patients/${MADISON_GRACE_PATIENT_ID}`} replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/medications"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <MedicationsOverviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/kidney-services"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <KidneyServicesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId"
          element={
            <ProtectedRoute allowedRoles={["clinician"]}>
              <PatientDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/medications"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <MedicationManagementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/notes-coding"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <NotesCodingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/respiratory-trends"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <RespiratoryTrendsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/home-health"
          element={
            <ProtectedRoute allowedRoles={["clinician"]}>
              <HomeHealthWorklistPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/home-health"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <ClinicianHomeHealthPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/pulmonary-rehab"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <PulmonaryRehabPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/renal-timeline"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <RenalTrendsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/care-coordination"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <CareCoordinationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/referrals"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <PatientDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/tasks"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <PatientTasksPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patients/:patientId/fhir-evidence"
          element={
            <ProtectedRoute allowedRoles={[...STAFF_ROLES]}>
              <PatientDashboardPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;
