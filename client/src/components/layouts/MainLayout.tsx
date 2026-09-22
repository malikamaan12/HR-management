import {useBranding} from '@/components/Branding';
import {defaultPublicBranding} from '@shared/branding';
import {useLocation} from 'wouter';
import { ReactNode, useEffect, useRef } from "react";
import { Helmet } from 'react-helmet';
import Sidebar from "./Sidebar";
import Header from "./Header";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import {ExperienceMotion,Reveal} from '@/components/ux/ExperienceUI';

interface MainLayoutProps {
  children: ReactNode;
  pageTitle: string;
  className?: string;
}

export default function MainLayout({ children, pageTitle, className }: MainLayoutProps) {
  const { theme } = useTheme();
  const {data:branding=defaultPublicBranding}=useBranding();
  const [location]=useLocation();
  const mainRef=useRef<HTMLElement>(null);
  useEffect(()=>{mainRef.current?.scrollTo({top:0,behavior:'instant'});},[location]);
  
  return (
    <ExperienceMotion><div className={cn(
      "app-shell flex h-dvh overflow-hidden bg-background",
      className
    )}>
      <Helmet><title>{pageTitle} | {branding.applicationName}</title></Helmet>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:p-3">Skip to content</a>
      <Sidebar />
      
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
        <Header pageTitle={pageTitle} />
        
        <main ref={mainRef} id="main-content" tabIndex={-1} className={cn(
          "module-workspace flex-1 min-w-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 relative z-10",
          theme === 'dark' ? 'text-gray-100' : 'text-gray-900'
        )}>
          <Reveal key={location} className="workspace-content mx-auto w-full max-w-[1600px]">{children}</Reveal>
        </main>
      </div>
    </div></ExperienceMotion>
  );
}
