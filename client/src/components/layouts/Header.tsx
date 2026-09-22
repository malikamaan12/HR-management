import HubIndicator from '@/components/communications/HubIndicator';
import ModuleLauncher from '@/components/ux/ModuleLauncher';
import {canOpenPage,pageForPath,roleLabel} from '@shared/navigation';
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, Settings, Moon, Sun } from "lucide-react";

interface HeaderProps {
  pageTitle: string;
}

export default function Header({ pageTitle }: HeaderProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location, setLocation] = useLocation();

  const handleLogout = async () => {
    try {
      await logout();
      // Redirect will be handled by auth context
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleAccountClick = () => {
    setLocation('/account');
  };

  const handleSettingsClick = () => {
    setLocation('/settings');
  };
  
  const handleThemeToggle = () => {
    toggleTheme();
  };

  return (
    <header className="z-20 border-b bg-card text-foreground">
      <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="flex min-w-0 items-center gap-2 text-sm"><span className="hidden text-muted-foreground sm:inline">{pageForPath(location)?.section||'Workspace'}</span><span aria-hidden="true" className="hidden text-muted-foreground/50 sm:inline">/</span><span className="font-medium line-clamp-1">{pageTitle}</span></div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="hidden md:block"><ModuleLauncher/></div>
            {/* Theme Toggle Button */}
            <Button
              variant="ghost"
              size="icon"
              className={cn("rounded-full", 
                theme === 'dark' ? 'text-yellow-300 hover:text-yellow-200 hover:bg-gray-700' : 'text-gray-500 hover:text-gray-700'
              )}
              onClick={handleThemeToggle}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </Button>
            
            {canOpenPage(user?.role,pageForPath('/communications')!)&&<HubIndicator onOpen={()=>setLocation('/communications')}/>}
            {/* User Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="Open account menu" className="flex items-center space-x-2 rounded-full overflow-hidden">
                  <Avatar className={cn("h-9 w-9 cursor-pointer ring-2 ring-offset-2 ring-primary", 
                    theme === 'dark' ? 'ring-offset-gray-800' : 'ring-offset-white'
                  )}>
                    <AvatarImage 
                      src={user?.avatar || ''} 
                      alt={user?.firstName || 'User'} 
                    />
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56" 
                sideOffset={12}
              >
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="font-medium">{user?.firstName} {user?.lastName}</p>
                    <p className="text-xs text-muted-foreground">{user&&roleLabel(user.role)}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer" onClick={handleAccountClick}>
                  <User className="mr-2 h-4 w-4" />
                  <span>My Account</span>
                </DropdownMenuItem>
                {canOpenPage(user?.role,pageForPath('/settings')!)&&<DropdownMenuItem className="cursor-pointer" onClick={handleSettingsClick}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
