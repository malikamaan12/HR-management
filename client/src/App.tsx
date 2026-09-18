import {canOpenPage} from '@shared/page-access';







import { Switch, Route, useLocation, Redirect, Link } from "wouter";
import MainLayout from "@/components/layouts/MainLayout";
import NotFound from "@/pages/not-found";


















import PasswordRecovery from "@/pages/PasswordRecovery";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";



import { Loader2 } from "lucide-react";
import { useState, useEffect, ReactNode, lazy, Suspense } from "react";
import {PageBoundary} from "@/components/layouts/PageBoundary";
import { useAuth } from "@/contexts/AuthContext";

const Equipment=lazy(()=>import('@/pages/Equipment'));
const Handbook=lazy(()=>import('@/pages/Handbook'));
const EmployeeServices=lazy(()=>import('@/components/lifecycle/EmployeeServices'));
const OperationsCenter=lazy(()=>import('@/components/lifecycle/OperationsCenter'));
const Learning=lazy(()=>import('@/components/lifecycle/Learning'));
const Dashboard=lazy(()=>import('@/pages/Dashboard'));
const EmployeeDatabase=lazy(()=>import('@/pages/EmployeeDatabase'));
const Payroll=lazy(()=>import('@/pages/Payroll'));
const Attendance=lazy(()=>import('@/pages/Attendance'));
const Leave=lazy(()=>import('@/pages/Leave'));
const Documents=lazy(()=>import('@/pages/Documents'));
const EventStaff=lazy(()=>import('@/pages/EventStaff'));
const Workforce=lazy(()=>import('@/pages/Workforce'));
const Helpdesk=lazy(()=>import('@/pages/Helpdesk'));
const Timesheets=lazy(()=>import('@/pages/Timesheets'));
const AssignmentReviews=lazy(()=>import('@/pages/AssignmentReviews'));
const TeamOverview=lazy(()=>import('@/pages/TeamOverview'));
const Settings=lazy(()=>import('@/pages/Settings'));
const Reports=lazy(()=>import('@/pages/Reports'));
const Recruitment=lazy(()=>import('@/pages/Recruitment'));
const Onboarding=lazy(()=>import('@/pages/Onboarding'));
const Communications=lazy(()=>import('@/pages/Communications'));
const Performance=lazy(()=>import('@/pages/Performance'));
const UserManagement=lazy(()=>import('@/pages/UserManagement'));
const UserAccount=lazy(()=>import('@/pages/UserAccount'));
const BulkImport=lazy(()=>import('@/pages/BulkImport'));
const Contracts=lazy(()=>import('@/pages/EmploymentContinuity').then(m=>({default:m.Contracts})));
const ReturnToWork=lazy(()=>import('@/pages/EmploymentContinuity').then(m=>({default:m.ReturnToWork})));
const ExitTemplates=lazy(()=>import('@/pages/EmploymentContinuity').then(m=>({default:m.ExitTemplates})));
const Probation=lazy(()=>import('@/pages/PeopleOperations').then(m=>({default:m.Probation})));
const Transfers=lazy(()=>import('@/pages/PeopleOperations').then(m=>({default:m.Transfers})));
const Incidents=lazy(()=>import('@/pages/PeopleOperations').then(m=>({default:m.Incidents})));
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
    if(location.startsWith('/assignment-reviews'))return 'Assignment reviews';
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
      case '/event-staff': return 'Event Staff Management';
      case '/workforce': return 'Workforce';
      case '/recruitment': return 'Recruitment Management';
      case '/onboarding': return 'Employee Onboarding';
      case '/communications': return 'Communication Hub';
      case '/expenses': return 'Expense reimbursement';
      case '/benefits': return 'Benefits enrollment';
      case '/service-operations': return 'Service operations';
      case '/learning': return 'Training and development';
      case '/performance': return 'Performance Management';
      case '/settings': return 'Settings';
      case '/reports': return 'Reports & Analytics';
      case '/user-management': return 'User Management';
      case '/contracts': return 'Contract renewals';
      case '/return-to-work': return 'Return-to-work clearance';
      case '/exit-templates': return 'Exit checklist templates';
      case '/probation': return 'Probation reviews';
      case '/transfers': return 'Employee transfers';
      case '/incidents': return 'Operational incidents';
      case '/equipment': return 'Equipment and assets';
      case '/handbook': return 'Policies and acknowledgements';
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
        {canOpenPage(user?.role,location)?<PageBoundary key={location}><Suspense fallback={<p role="status" className="p-6">Loading page…</p>}><Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/employees" component={EmployeeDatabase} />
          <Route path="/payroll" component={Payroll} />
          <Route path="/attendance" component={Attendance} />
          <Route path="/leave" component={Leave} />
          <Route path="/documents" component={Documents} />
          <Route path="/event-staff/archive" component={EventArchive} />
          <Route path="/event-staff" component={EventStaff} />
          <Route path="/workforce" component={Workforce} />
          <Route path="/assignment-reviews" component={AssignmentReviews} />
          <Route path="/assignment-reviews/:id" component={AssignmentReviews} />
          <Route path="/team-overview" component={TeamOverview} />
          <Route path="/timesheets" component={Timesheets} />
          <Route path="/timesheets/:id" component={Timesheets} />
          <Route path="/helpdesk" component={Helpdesk} />
          <Route path="/helpdesk/:caseId" component={Helpdesk} />
          <Route path="/recruitment" component={Recruitment} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/communications" component={Communications} />
          <Route path="/expenses">{()=><EmployeeServices key="expense" kind="expense"/>}</Route>
          <Route path="/benefits">{()=><EmployeeServices key="benefit" kind="benefit"/>}</Route>
          <Route path="/service-operations" component={OperationsCenter}/>
          <Route path="/learning" component={Learning} /><Route path="/contracts" component={Contracts}/><Route path="/return-to-work" component={ReturnToWork}/><Route path="/exit-templates" component={ExitTemplates}/><Route path="/probation" component={Probation}/><Route path="/transfers" component={Transfers}/><Route path="/incidents" component={Incidents}/><Route path="/equipment" component={Equipment}/><Route path="/handbook" component={Handbook}/>
          <Route path="/performance" component={Performance} />
          <Route path="/settings" component={Settings} />
          <Route path="/reports" component={Reports} />
          <Route path="/user-management" component={UserManagement} />
          <Route path="/account" component={UserAccount} />
          <Route path="/bulk-import" component={BulkImport} />
          <Route component={NotFound} />
        </Switch></Suspense></PageBoundary>:<section className="mx-auto max-w-xl space-y-4 rounded-lg border bg-card p-6" role="alert"><h2 className="text-xl font-semibold">Access restricted</h2><p>Your role does not have access to this page. Contact an administrator if your responsibilities have changed.</p><div className="flex gap-4"><Link href="/" className="text-primary underline">Dashboard</Link><Link href="/helpdesk" className="text-primary underline">HR Helpdesk</Link></div></section>}
      </MainLayout>
    </ProtectedRoute>
  );
}

export default App;
