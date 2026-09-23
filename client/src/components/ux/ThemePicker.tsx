import {Sun, Moon, Monitor} from 'lucide-react';
import {useTheme, type ThemePreference} from '@/contexts/ThemeContext';
import {Button} from '@/components/ui/button';
import {DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';

export default function ThemePicker() {
  const {theme, preference, setPreference} = useTheme();
  const Icon = preference === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="theme-picker gap-2" aria-label={`Color theme: ${preference}. Choose appearance`}><Icon className="h-4 w-4"/><span className="hidden sm:inline">{preference === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Appearance</DropdownMenuLabel><DropdownMenuSeparator/><DropdownMenuRadioGroup value={preference} onValueChange={value=>setPreference(value as ThemePreference)}><DropdownMenuRadioItem value="light"><Sun className="mr-2 h-4 w-4"/>Light</DropdownMenuRadioItem><DropdownMenuRadioItem value="dark"><Moon className="mr-2 h-4 w-4"/>Dark</DropdownMenuRadioItem><DropdownMenuRadioItem value="system"><Monitor className="mr-2 h-4 w-4"/>Use device setting</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>;
}
