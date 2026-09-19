import { ReactNode } from "react";
import { Helmet } from 'react-helmet';
import Sidebar from "./Sidebar";
import Header from "./Header";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";

interface MainLayoutProps {
  children: ReactNode;
  pageTitle: string;
  className?: string;
}

export default function MainLayout({ children, pageTitle, className }: MainLayoutProps) {
  const { theme } = useTheme();
  
  return (
    <div className={cn(
      "flex h-screen overflow-hidden", 
      theme === 'dark' ? 'bg-[#0F172A]' : 'bg-[#F8F9FA]',
      className
    )}>
      <Helmet><title>{pageTitle} | E3 HR System</title></Helmet>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:p-3">Skip to content</a>
      <Sidebar />
      
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
        {/* Aurora Mesh Blurs */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#46A6A9]/10 blur-[100px] pointer-events-none rounded-full -mr-48 -mt-48" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#6A4FB3]/10 blur-[100px] pointer-events-none rounded-full -ml-48 -mb-48" />
        
        <Header pageTitle={pageTitle} />
        
        <main id="main-content" tabIndex={-1} className={cn(
          "flex-1 min-w-0 overflow-y-auto px-4 py-6 sm:px-6 relative z-10",
          theme === 'dark' ? 'text-gray-100' : 'text-gray-900'
        )}>
          {children}
        </main>
      </div>
    </div>
  );
}
