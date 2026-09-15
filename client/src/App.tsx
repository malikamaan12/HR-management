import { Switch, Route, useLocation, Redirect } from "wouter";
import MainLayout from "@/components/layouts/MainLayout";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import EmployeeDatabase from "@/pages/EmployeeDatabase";
import Payroll from "@/pages/PayrollOperations";
import Attendance from "@/pages/AttendanceOperations";
import Leave from "@/pages/Leave";
import HrRules from '@/pages/HrRules';
import Documents from "@/pages/Documents";
import EventStaff from "@/pages/EventStaff";
import Workforce from "@/pages/Workforce";
import Helpdesk from "@/pages/Helpdesk";
import Timesheets from "@/pages/Timesheets";
import AssignmentReviews from "@/pages/AssignmentReviews";
import TeamOverview from "@/pages/TeamOverview";
import Settings from "@/pages/Settings";
import Reports from "@/pages/Reports";
import Recruitment from "@/pages/Hiring";
import Onboarding from "@/pages/Lifecycle";
import Communications from "@/pages/Communications";
import Performance from "@/pages/Performance";
import PasswordRecovery from "@/pages/PasswordRecovery";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import UserManagement from "@/pages/UserManagement";
import UserAccount from "@/pages/UserAccount";
import BulkImport from "@/pages/BulkImport";
import { Loader2 } from "lucide-react";
import { useState, useEffect, ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

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
      case '/onboarding': return 'Onboarding and Offboarding';
      case '/hr-rules': return 'HR Rules';
      case '/communications': return 'Communication Hub';
      case '/performance': return 'Performance Management';
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
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/employees" component={EmployeeDatabase} />
          <Route path="/payroll" component={Payroll} />
          <Route path="/attendance" component={Attendance} />
          <Route path="/leave" component={Leave} />
          <Route path="/hr-rules" component={HrRules} />
          <Route path="/documents" component={Documents} />
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
          <Route path="/performance" component={Performance} />
          <Route path="/settings" component={Settings} />
          <Route path="/reports" component={Reports} />
          <Route path="/user-management" component={UserManagement} />
          <Route path="/account" component={UserAccount} />
          <Route path="/bulk-import" component={BulkImport} />
          <Route component={NotFound} />
        </Switch>
      </MainLayout>
    </ProtectedRoute>
  );
}

export default App;
