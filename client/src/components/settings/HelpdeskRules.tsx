import {useQuery} from '@tanstack/react-query';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {QueryError} from '@/components/hr/Operations';
import {HelpdeskSettings} from '@/components/hr/HelpdeskSettings';
import {HelpdeskPolicies} from '@/components/hr/HelpdeskOperations';
import {HelpdeskAutomationAccess} from '@/components/hr/HelpdeskAutomation';
import type {HelpdeskConfig} from '@shared/helpdesk';

export default function HelpdeskRules(){
  const query=useQuery<HelpdeskConfig>({queryKey:['/api/helpdesk/config']});
  return <div className="space-y-4"><QueryError error={query.error}/>{query.isLoading&&<p role="status">Loading helpdesk settings…</p>}
    {query.data?.canManagePolicies&&<Tabs defaultValue="content"><TabsList aria-label="Helpdesk settings"><TabsTrigger value="content">Content & categories</TabsTrigger><TabsTrigger value="routing">Routing & response</TabsTrigger><TabsTrigger value="automation">Automation</TabsTrigger></TabsList>
      <TabsContent value="content"><HelpdeskSettings config={query.data}/></TabsContent>
      <TabsContent value="routing"><HelpdeskPolicies config={query.data}/></TabsContent>
      <TabsContent value="automation"><HelpdeskAutomationAccess/></TabsContent>
    </Tabs>}</div>;
}
