import PageAccessGuard from '@/components/PageAccessGuard';


import { Switch, Route, useLocation, Redirect } from "wouter";
import MainLayout from "@/components/layouts/MainLayout";
import NotFound from "@/pages/not-found";



















import PasswordRecovery from "@/pages/PasswordRecovery";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";



import { Loader2 } from "lucide-react";
import { useState, useEffect, ReactNode, lazy, Suspense } from "react";
import {PageBoundary} from "@/components/layouts/PageBoundary";
import { useAuth } from "@/contexts/AuthContext";

const Learning=lazy(()=>import('@/pages/Learning'));
const Dashboard=lazy(()=>import('@/pages/Dashboard'));
const EmployeeDatabase=lazy(()=>import('@/pages/EmployeeDatabase'));
const Payroll=lazy(()=>import('@/pages/PayrollOperations'));
const Attendance=lazy(()=>import('@/pages/AttendanceOperations'));
const Leave=lazy(()=>import('@/pages/Leave'));
const Documents=lazy(()=>import('@/pages/Documents'));
const EventStaff=lazy(()=>import('@/pages/EventStaff'));
const Workforce=lazy(()=>import('@/pages/Workforce'));
const Helpdesk=lazy(()=>import('@/pages/Helpdesk'));
const Timesheets=lazy(()=>import('@/pages/Timesheets'));
const AssignmentReviews=lazy(()=>import('@/pages/AssignmentReviews'));
const TeamOverview=lazy(()=>import('@/pages/TeamOverview'));
const OrgCharts=lazy(()=>import('@/pages/OrgCharts'));
const Settings=lazy(()=>import('@/pages/Settings'));
const Reports=lazy(()=>import('@/pages/Reports'));
const Recruitment=lazy(()=>import('@/pages/Hiring'));
const Onboarding=lazy(()=>import('@/pages/Lifecycle'));
const Equipment=lazy(()=>import('@/pages/Equipment'));
const Handbook=lazy(()=>import('@/pages/Handbook'));
const HrLetters=lazy(()=>import('@/pages/HrLetters'));
const Employment=lazy(()=>import('@/pages/Employment'));
const Retention=lazy(()=>import('@/pages/Retention'));
const Communications=lazy(()=>import('@/pages/Communications'));
const Performance=lazy(()=>import('@/pages/Performance'));
const UserAccount=lazy(()=>import('@/pages/UserAccount'));
const BulkImport=lazy(()=>import('@/pages/BulkImport'));
const Benefits=lazy(()=>import('@/pages/EmployeeServices').then(m=>({default:m.Benefits})));
const Expenses=lazy(()=>import('@/pages/EmployeeServices').then(m=>({default:m.Expenses})));
const EventArchive=lazy(()=>import('@/pages/EventArchive'));
// Protected route wrapper
interface ProtectedRouteProps {
  children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation('/login');
    }
  }, [isAuthenticated, isLoading, setLocation]);
  
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }
  
  return isAuthenticated ? <>{children}</> : null;
};

/**
 * Main App component with routing
 */
function App() {
  const [location, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading, checkTokenExpiration } = useAuth();
  
  // Check authentication on initial load and navigate to login if needed
  useEffect(() => {
    const validateAuth = async () => {
      // Check if we have a valid token
      const isValid = await checkTokenExpiration();
      
      // If no valid token and not already on login or signup page, redirect to login
      if (!isLoading && !isValid && !['/login', '/signup', '/forgot-password', '/reset-password'].includes(location)) {
        setLocation('/login');
      }
    };
    
    validateAuth();
  }, [location, setLocation, checkTokenExpiration, isLoading]);
  
  // Get page title based on current location
  const getPageTitle = () => {
    if(location==='/settings'||location.startsWith('/settings/'))return 'HR Rules & Settings';
    if(location.startsWith('/assignment-reviews'))return 'Assignment reviews';
    if(location.startsWith('/org-charts'))return 'Organization charts';
    if(location.startsWith('/team-overview'))return 'Team overview';
    if(location.startsWith('/timesheets'))return 'Timesheets';
    if(location==='/helpdesk'||location.startsWith('/helpdesk/'))return 'HR Helpdesk';
    switch (location) {
      case '/': return 'Dashboard';
      case '/employees': return 'Employee Database';
      case '/payroll': return 'Payroll Management';
      case '/attendance': return 'Attendance Tracking';
      case '/leave': return 'Leave Management';
      case '/documents': return 'Document Management';
      case '/hr-letters': return 'HR Letter Centre';
      case '/event-staff/archive': return 'Event Archive';
      case '/event-staff': return 'Event Staff Management';
      case '/workforce': return 'Workforce';
      case '/recruitment': return 'Recruitment Management';
      case '/onboarding': return 'Onboarding and Offboarding';
      case '/equipment': return 'Equipment and Returns';
      case '/handbook': return 'Employee Handbook';
      case '/employment': return 'Employment and Service History';
      case '/retention': return 'Record Retention';
      case '/reminder-rules': return 'Reminder Rules';
      case '/hr-rules': return 'HR Rules';
      case '/operations-setup': return 'Operational setup';
      case '/communications': return 'Communication Hub';
      case '/performance': return 'Performance Management';
      case '/learning': return 'Learning & Training';
      case '/benefits': return 'Benefits & Entitlements';
      case '/expenses': return 'Expenses & Reimbursements';
      case '/settings': return 'Settings';
      case '/reports': return 'Reports & Analytics';
      case '/user-management': return 'User Management';
      case '/account': return 'My Account';
      case '/bulk-import': return 'Bulk Employee Import';
      case '/login': return 'Login';
      default: return 'E3 HR System';
    }
  };

  // For login/signup pages, we render them without MainLayout
  if (location === '/forgot-password') return <PasswordRecovery />;
  if (location === '/reset-password') return <PasswordRecovery reset />;
  if (location === '/login') {
    return <Login />;
  }
  
  if (location === '/signup') {
    return <Signup />;
  }
  
  // While authentication is being checked, show a loader
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }
  
  return (
    <ProtectedRoute>
      <MainLayout pageTitle={getPageTitle()}>
        <PageBoundary key={location}><PageAccessGuard><Suspense fallback={<p role="status" className="p-6">Loading page…</p>}><Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/employees" component={EmployeeDatabase} />
          <Route path="/payroll" component={Payroll} />
          <Route path="/attendance" component={Attendance} />
          <Route path="/leave" component={Leave} />
          <Route path="/hr-rules"><Redirect to="/settings/attendance"/></Route>
          <Route path="/operations-setup"><LegacySetupRedirect/></Route>
          <Route path="/documents" component={Documents} />
          <Route path="/hr-letters" component={HrLetters} />
          <Route path="/event-staff/archive" component={EventArchive} />
          <Route path="/event-staff" component={EventStaff} />
          <Route path="/workforce"><Workforce /></Route>
          <Route path="/assignment-reviews" component={AssignmentReviews} />
          <Route path="/assignment-reviews/:id" component={AssignmentReviews} />
          <Route path="/org-charts" component={OrgCharts} />
          <Route path="/team-overview" component={TeamOverview} />
          <Route path="/timesheets" component={Timesheets} />
          <Route path="/timesheets/:id" component={Timesheets} />
          <Route path="/helpdesk" component={Helpdesk} />
          <Route path="/helpdesk/:caseId" component={Helpdesk} />
          <Route path="/recruitment" component={Recruitment} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/equipment" component={Equipment} />
          <Route path="/handbook" component={Handbook} />
          <Route path="/employment" component={Employment} />
          <Route path="/retention"><Retention/></Route>
          <Route path="/reminder-rules"><Redirect to="/settings/reminders"/></Route>
          <Route path="/communications" component={Communications} />
          <Route path="/performance" component={Performance} />
          <Route path="/learning" component={Learning} />
          <Route path="/benefits" component={Benefits} />
          <Route path="/expenses" component={Expenses} />
          <Route path="/settings/locations"><Redirect to="/settings/devices?tab=geofencing"/></Route>
          <Route path="/settings/:section" component={Settings} />
          <Route path="/settings" component={Settings} />
          <Route path="/reports" component={Reports} />
          <Route path="/user-management"><Redirect to="/settings/accounts"/></Route>
          <Route path="/account" component={UserAccount} />
          <Route path="/bulk-import" component={BulkImport} />
          <Route component={NotFound} />
        </Switch></Suspense></PageAccessGuard></PageBoundary>
      </MainLayout>
    </ProtectedRoute>
  );
}

export default App;

function LegacySetupRedirect(){
 const tab=new URLSearchParams(window.location.search).get('tab')||'overview';
 const section:Record<string,string>={overview:'setup',locations:'locations',supervisors:'teams',leave:'leave',induction:'training',services:'readiness'};
 return <Redirect to={'/settings/'+(section[tab]||'setup')}/>;
}
