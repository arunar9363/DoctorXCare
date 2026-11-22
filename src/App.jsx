// src/App.jsx
import { lazy, Suspense, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Outlet, Navigate, useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "./firebase";
import { Analytics } from '@vercel/analytics/react';

// Components
import Navbar from "./components/common/Navbar";
import Footer from "./components/common/Footer";
import LoginModal from "./components/common/LoginModal";
import ScrollToTop from "./components/common/ScrollToTop";
import Audience from "./components/sections/Audience";
import About from "./components/sections/AboutUs";
import Services from "./components/features/ServiceList";
import ProfilePage from "./pages/ProfilePage";
import Toast from "./components/common/Toast";


// Pages
import Home from "./pages/Home";
import ContactPage from "./pages/ContactUsPage";
import SymptomPage from "./pages/SymptomPage";
import RegisterPage from "./pages/RegisterPage";
import TermsOfService from "./pages/TermsOfService";
import HistoryPage from "./pages/HistoryPage";
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from "./pages/Dashboard";

const DiseaseSearch = lazy(() => import("./components/features/DiseaseSearch"));
const IndividualDiseasesInfo = lazy(() => import("./components/features/IndividualDiseaseInfo"));
const SymptomAssessment = lazy(() => import("./components/features/SymptomAssessment"));
const LabUpload = lazy(() => import("./components/features/ai-agents/LabAnalysis/LabUpload"));
const ChronicCareLanding = lazy(() => import("./components/features/ai-agents/HealthTracking/ChronicCareLanding"));
const TrackingChartsPage = lazy(() => import("./components/features/ai-agents/HealthTracking/TrackingChartsPage"));
const TrackerDashboard = lazy(() => import("./components/features/ai-agents/HealthTracking/TrackerDashboard"));
const DoctorXAIPage = lazy(() => import("./pages/DoctorXAIPage"));
const AIDoctorPage = lazy(() => import("./pages/AIDoctorPage"));
const FinderMap = lazy(() => import("./components/features/ai-agents/SpecialistFinder/FinderMap"));


// Wrapper for login modal page
function LoginPageWrapper() {
  const navigate = useNavigate();
  return <LoginModal show onClose={() => navigate("/")} />;
}

function ProfilePageRoute() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  return (
    <>
      <ProfilePage show onClose={() => navigate("/dashboard")} onShowToast={(message, type) => setToast({ message, type })} />
      {toast && <Toast {...toast} show onClose={() => setToast(null)} />}
    </>
  );
}

// Protected Router Component
const ProtectedRouter = () => {
  const [user, loading] = useAuthState(auth);

  if (loading) {
    return <div>Loading...</div>;
  }

  return user ? <Outlet /> : <Navigate to="/" />;
};

// Layout wrapper
function Layout({ children }) {
  return (
    <div className="landing-page">
      <Navbar />
      {children}
      <Footer />
    </div>
  );
}

function App() {
  return (
    <Router>
      <ScrollToTop />
      <Layout>
        <Suspense fallback={<p role="status" className="text-center py-4">Loading service...</p>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/audience" element={<Audience />} />
          <Route path="/aboutus" element={<About />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/login" element={<LoginPageWrapper />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route path="/healthcare-network" element={<FinderMap />} />

          {/* Protected Routes */}
          <Route element={<ProtectedRouter />}>
            <Route path="/services" element={<Services />} />
            <Route path="/diseases" element={<DiseaseSearch />} />
            <Route path="/diseases/:diseaseName" element={<IndividualDiseasesInfo />} />
            <Route path="/symptoms" element={<SymptomPage />} />
            <Route path="/symptom-checker" element={<SymptomAssessment />} />
            <Route path="/lab-analysis" element={<LabUpload />} />
            <Route path="/health-tracking/chronic-care" element={<ChronicCareLanding />} />
            <Route path="/health-tracking/charts" element={<TrackingChartsPage />} />
            <Route path="/health-tracking/dashboard" element={<TrackerDashboard />} />
            <Route path="/doctorx-ai" element={<DoctorXAIPage />} />
            <Route path="/ai-doctor" element={<AIDoctorPage />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/my-profile" element={<ProfilePageRoute />} />

          </Route>

        </Routes>
        </Suspense>
      </Layout>
      <Analytics />
    </Router>
  );
}

export default App;
