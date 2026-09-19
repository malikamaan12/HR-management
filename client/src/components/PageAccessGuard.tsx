import type {ReactNode} from 'react';
import {Link,useLocation} from 'wouter';
import {usePageAccess} from '@/hooks/usePageAccess';
import {pageForPath,roleLabel} from '@shared/navigation';
import {workforceAdmin} from '@shared/workforce';
export default function PageAccessGuard({children}:{children:ReactNode}){
 const [location]=useLocation(),{user,allowed,teamsLoading,teamsError}=usePageAccess(),page=pageForPath(location);
 if(!page)return <>{children}</>;
 if(page.access==='team'&&user&&!workforceAdmin(user.role)&&teamsLoading)return <p role="status">Checking your team access…</p>;
 if(!allowed(page))return <section className="mx-auto max-w-xl rounded-xl border bg-card p-8"><h1 className="text-2xl font-semibold">{teamsError&&page.access==='team'?'Unable to verify team access':'This page is not available to your account'}</h1><p className="mt-3 text-muted-foreground">{page.access==='team'?'A current team assignment with access is required. Ask HR to check your dated team access.':`Your ${user?roleLabel(user.role):'current'} role does not include access to ${page.label}.`}</p><p className="mt-2 text-sm text-muted-foreground">Contact an administrator if your responsibilities have changed.</p><Link href="/" className="mt-6 inline-block rounded bg-primary px-4 py-2 text-primary-foreground">Return to dashboard</Link></section>;
 return <>{children}</>;
}
