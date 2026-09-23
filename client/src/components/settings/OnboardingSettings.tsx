import {useQuery} from '@tanstack/react-query';
import {LifecycleTemplates,LifecycleReviewPolicy} from '@/components/onboarding/LifecycleTemplates';
import {QueryError} from '@/components/hr/Operations';

type Options={canManage:boolean;canTemplates:boolean;canPolicy:boolean};
export default function OnboardingSettings({templatesOnly=false}:{templatesOnly?:boolean}){
  const options=useQuery<Options>({queryKey:['/api/lifecycle/options']});
  const templates=useQuery<any[]>({queryKey:['/api/lifecycle/templates'],enabled:templatesOnly&&!!options.data?.canManage});
  return <div className="space-y-4"><QueryError error={options.error||templates.error}/>
    {(options.isLoading||templates.isLoading)&&<p role="status">Loading onboarding settings…</p>}
    {options.data?.canManage&&(templatesOnly
      ?templates.data&&<LifecycleTemplates templates={templates.data} canEdit={options.data.canTemplates}/>
      :<LifecycleReviewPolicy canEdit={options.data.canPolicy}/>)}</div>;
}
