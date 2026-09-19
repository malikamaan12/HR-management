import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/contexts/AuthContext';
import {canOpenPage,pages,type PageDefinition} from '@shared/navigation';
import type {WorkforceHome} from '@shared/workforce';
export function usePageAccess(){
 const {user}=useAuth();
 const teams=useQuery<WorkforceHome>({queryKey:['/api/workforce/teams'],enabled:!!user,staleTime:30000,refetchInterval:60000});
 const allowed=(page:PageDefinition)=>canOpenPage(user?.role,page,!teams.error&&!!teams.data?.teams.length);
 return {user,allowed,pages:pages.filter(allowed),teamsLoading:teams.isLoading,teamsError:teams.error};
}
