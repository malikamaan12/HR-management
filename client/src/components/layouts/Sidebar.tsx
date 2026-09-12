import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { NavigationItem } from "@/hooks/usePermissions";
import { useTheme } from "@/contexts/ThemeContext";

interface SidebarProps {
  className?: string;
}

import type { HRModule } from "@shared/permissions";

interface NavItem {
  name: string;
  icon: string;
  href: string;
  module: HRModule;
  section?: string;
  requiredPermission?: 'read' | 'create' | 'update' | 'admin';
}

const navItems: NavItem[] = [
  { name: "Dashboard", icon: "fas fa-tachometer-alt", href: "/", module: "reports_analytics", requiredPermission: "read" },
  { name: "Employee Database", icon: "fas fa-users", href: "/employees", module: "employee_database", requiredPermission: "read" },
  { name: "Bulk Import", icon: "fas fa-upload", href: "/bulk-import", module: "employee_database", requiredPermission: "create" },
  { name: "Recruitment", icon: "fas fa-user-plus", href: "/recruitment", module: "recruitment_onboarding", requiredPermission: "read" },
  { name: "Onboarding", icon: "fas fa-clipboard-list", href: "/onboarding", module: "recruitment_onboarding", requiredPermission: "read" },
  { name: "Payroll Management", icon: "fas fa-money-check-alt", href: "/payroll", module: "payroll_management", requiredPermission: "read" },
  { name: "Attendance Tracking", icon: "fas fa-calendar-check", href: "/attendance", module: "attendance_time_tracking", requiredPermission: "read" },
  { name: "Leave Management", icon: "fas fa-umbrella-beach", href: "/leave", module: "leave_absence_management", requiredPermission: "read" },
  { name: "Document Management", icon: "fas fa-file-alt", href: "/documents", module: "compliance_documents", requiredPermission: "read" },
  { name: "Event Staff", icon: "fas fa-id-badge", href: "/event-staff", module: "event_staff_management", requiredPermission: "read" },
  { name: "Performance Management", icon: "fas fa-chart-line", href: "/performance", module: "performance_management", requiredPermission: "read" },
  { name: "Communication Hub", icon: "fas fa-comments", href: "/communications", module: "communication_hub", requiredPermission: "read" },
  { name: "User Management", icon: "fas fa-user-shield", href: "/user-management", module: "system_configuration", section: "Admin", requiredPermission: "admin" },
  { name: "Settings", icon: "fas fa-cog", href: "/settings", module: "system_configuration", section: "Admin", requiredPermission: "admin" },
  { name: "Reports & Analytics", icon: "fas fa-chart-bar", href: "/reports", module: "reports_analytics", section: "Admin", requiredPermission: "read" },
];

export default function Sidebar({ className }: SidebarProps) {
  const [location, setLocation] = useLocation();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  
  const handleLogout = async () => {
    try {
      await logout();
      // Redirection will be handled by AuthContext
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };
  
  // Close sidebar on location change for mobile
  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [location]);

  useEffect(() => {
    // Handle clicks outside the sidebar on mobile to close it
    const handleClickOutside = (event: MouseEvent) => {
      const sidebar = document.getElementById('sidebar');
      const toggle = document.getElementById('sidebarToggle');
      
      if (sidebar && !sidebar.contains(event.target as Node) && 
          toggle && !toggle.contains(event.target as Node) && 
          window.innerWidth < 768 && isMobileSidebarOpen) {
        setIsMobileSidebarOpen(false);
      }
    };
    
    // Handle window resize to close mobile sidebar when resizing to desktop
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileSidebarOpen(false);
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    window.addEventListener('resize', handleResize);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
      window.removeEventListener('resize', handleResize);
    };
  }, [isMobileSidebarOpen]);

  return (
    <>
      {/* Mobile sidebar toggle button - visible only on mobile */}
      <button 
        id="sidebarToggle"
        className="md:hidden fixed bottom-4 right-4 z-50 bg-primary text-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
        onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
      >
        <i className={`fas ${isMobileSidebarOpen ? 'fa-times' : 'fa-bars'}`}></i>
      </button>
      
      {/* Sidebar */}
      <aside 
        id="sidebar"
        className={cn(
          "z-30 flex-shrink-0 w-64 h-full shadow-lg transition-transform duration-300 ease-in-out",
          theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-gray-900',
          "fixed md:sticky left-0 top-0 h-screen",
          "transform md:translate-x-0",
          isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
          className
        )}
      >
        <div className="flex flex-col h-full">
          {/* Company Logo and System Name */}
          <div className={cn(
            "px-6 py-4 border-b",
            theme === 'dark' ? 'border-gray-700' : 'border-neutral-200'
          )}>
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary rounded-md flex items-center justify-center text-white text-xl font-bold">
                E3
              </div>
              <div>
                <h1 className={cn(
                  "text-lg font-poppins font-semibold",
                  theme === 'dark' ? 'text-white' : 'text-neutral-900'
                )}>E3 HR System</h1>
                <p className={cn(
                  "text-xs",
                  theme === 'dark' ? 'text-gray-400' : 'text-neutral-500'
                )}>Qatar HR Management</p>
              </div>
            </div>
          </div>
          
          {/* Navigation Menu */}
          <nav className="flex-1 overflow-y-auto py-4">
            <ul className="space-y-1 px-3">
              {navItems.map((item, index) => {
                const isActive = location === item.href;
                
                // Check if this is the start of a new section
                const isNewSection = item.section && (index === 0 || navItems[index - 1].section !== item.section);
                
                return (
                  <NavigationItem 
                    key={item.href} 
                    module={item.module} 
                    requiredPermission={item.requiredPermission || 'read'}
                  >
                    <li>
                      {isNewSection && (
                        <h3 className={cn(
                          "mt-6 border-t pt-4 px-3 text-xs font-semibold uppercase tracking-wider",
                          theme === 'dark' ? 'border-gray-700 text-gray-400' : 'border-neutral-200 text-neutral-500'
                        )}>
                          {item.section}
                        </h3>
                      )}
                    <Link
                      to={item.href}
                      className={cn(
                        "sidebar-item flex items-center px-3 py-2 rounded-md group cursor-pointer",
                        theme === 'dark' 
                          ? `text-gray-300 hover:bg-gray-700 hover:text-white ${isActive ? 'border-l-4 border-primary bg-gray-700/50' : ''}` 
                          : `text-neutral-700 hover:bg-neutral-100 ${isActive ? 'border-l-4 border-primary bg-primary/10' : ''}`
                      )}
                    >
                      <i className={cn(
                        item.icon, 
                        "w-6",
                        isActive 
                          ? "text-primary" 
                          : theme === 'dark' 
                            ? "text-gray-400 group-hover:text-white" 
                            : "text-neutral-500 group-hover:text-primary"
                      )}></i>
                      <span className={cn(
                        "ml-3",
                        isActive && "font-medium"
                      )}>{item.name}</span>
                    </Link>
                    </li>
                  </NavigationItem>
                );
              })}
            </ul>
          </nav>
          
          {/* User Profile Section */}
          <div className={cn(
            "border-t p-4", 
            theme === 'dark' ? 'border-gray-700' : 'border-neutral-200'
          )}>
            <div className="flex items-center">
              <div className="h-10 w-10 rounded-full bg-primary text-white flex items-center justify-center text-sm font-medium overflow-hidden">
                {user?.avatar ? (
                  <img 
                    src={user.avatar} 
                    alt={`${user.firstName} ${user.lastName}`} 
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <>{user?.firstName?.[0] || ''}{user?.lastName?.[0] || ''}</>
                )}
              </div>
              <div className="ml-3">
                <p className={cn(
                  "text-sm font-medium", 
                  theme === 'dark' ? 'text-white' : 'text-neutral-800'
                )}>
                  {user?.firstName} {user?.lastName}
                </p>
                <p className={cn(
                  "text-xs", 
                  theme === 'dark' ? 'text-gray-400' : 'text-neutral-500'
                )}>{user?.role}</p>
              </div>
              
              <div className="flex items-center ml-auto">
                <Link to="/account" className={cn(
                  "mr-3",
                  theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-neutral-400 hover:text-primary'
                )}>
                  <i className="fas fa-user-circle"></i>
                </Link>
                <button 
                  onClick={handleLogout}
                  className={cn(
                    theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-neutral-400 hover:text-primary'
                  )}
                  title="Logout"
                >
                  <i className="fas fa-sign-out-alt"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
