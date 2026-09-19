import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storageStepNames, type SystemReadiness as Readiness } from '@shared/system-readiness';
import { apiJson } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const endpoint = '/api/settings/system-readiness';
export default function SystemReadiness() {
  const cache = useQueryClient();
  const status = useQuery<Readiness>({ queryKey: [endpoint], staleTime: 0 });
  const refresh = () => cache.invalidateQueries({ queryKey: [endpoint] });
  const check = useMutation({ mutationFn: () => apiJson(endpoint + '/storage-check', { method: 'POST', body: {} }), onSettled: refresh });
  const cleanup = useMutation({ mutationFn: () => apiJson(endpoint + '/storage-cleanup', { method: 'POST', body: { checkedAt: status.data?.storage.lastCheck?.checkedAt } }), onSettled: refresh });
  const data = status.data, last = data?.storage.lastCheck, busy = check.isPending || cleanup.isPending;
  return <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Service readiness & recovery</CardTitle><Button variant="outline" disabled={status.isFetching || busy} onClick={() => void status.refetch()}>{status.isFetching ? 'Refreshing…' : 'Refresh service status'}</Button></div></CardHeader><CardContent className="space-y-5">
    <p className="text-sm text-muted-foreground">Check supporting services before importing employee records. Storage verification runs only when you start it.</p>
    {status.isLoading && <p role="status">Loading service status…</p>}
    {status.error && <p role="alert" className="text-destructive">Unable to load service status. Refresh to try again.</p>}
    {data && <>
      <p className="text-xs text-muted-foreground">Status retrieved {new Date(data.checkedAt).toLocaleString()}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded-lg border p-4 space-y-2"><h3 className="font-semibold">Database</h3><Badge variant={data.database.status === 'available' ? 'secondary' : 'destructive'}>{data.database.status === 'available' ? 'Connection verified' : 'Connection unavailable'}</Badge><p className="text-sm">Checks the application database connection. Backup restoration is verified separately.</p></article>
        <article className="rounded-lg border p-4 space-y-2"><h3 className="font-semibold">Email</h3><Badge variant="outline">{data.email.configured ? 'Configured · delivery not verified' : 'Configuration required'}</Badge><p className="text-sm">{data.email.missing.length ? `Missing or invalid: ${data.email.missing.join(', ')}.` : 'Resend credentials and sender settings are present. Verify the sender domain and complete a separately authorized delivery check.'}</p></article>
        <article className="rounded-lg border p-4 space-y-2"><h3 className="font-semibold">Application settings</h3><p className="text-sm">Public URL: {data.application.originConfigured ? 'Configured' : 'Missing or invalid'}</p><p className="text-sm">Attendance timezone: {data.application.timezoneValid ? data.application.timezone : 'Invalid — correct server timezone'}</p></article>
        <article className="rounded-lg border p-4 space-y-2"><h3 className="font-semibold">Database recovery</h3><Badge variant="outline">Restore drill required</Badge><p className="text-sm">Use the free backup and isolated restore tools from the recovery guide. Database backups contain file references; private documents and training media need a separate backup.</p><a className="text-sm text-primary underline" href="/api/settings/system-readiness/recovery-guide" download>Download recovery guide</a></article>
      </div>
      <article className="space-y-3 rounded-lg border p-4"><h3 className="font-semibold">Private file storage</h3>
        <p className="text-sm">{data.storage.provider}: {data.storage.configured ? 'Credentials configured' : 'Missing or invalid configuration'}</p>
        {!data.storage.historyAvailable && <p role="alert" className="text-sm text-destructive">Previous verification could not be loaded. Its status is unknown.</p>}
        {data.storage.configurationChanged && <p role="status" className="text-sm">Storage settings changed since the saved check. Run a new check for the current configuration.</p>}
        {last ? <div className="space-y-2"><p className="text-sm font-medium">Last check: {last.status === 'passed' ? 'Passed' : 'Needs attention'} · {new Date(last.checkedAt).toLocaleString()}</p><ul className="space-y-1 text-sm">{last.steps.map(step => <li key={step.id} className="flex flex-wrap justify-between gap-2"><span>{storageStepNames[step.id]}</span><span>{step.status === 'passed' ? 'Passed' : step.status === 'failed' ? 'Failed' : 'Not run'}</span></li>)}</ul></div> : <p className="text-sm">No completed storage verification is recorded.</p>}
        {!!last?.cleanupKey && <div role="alert" className="space-y-2 rounded border p-3 text-sm"><p>A temporary check file still needs cleanup: <code className="break-all">{last.cleanupKey}</code>. Retry cleanup before the next check.</p><Button variant="outline" disabled={busy || data.storage.configurationChanged} onClick={() => cleanup.mutate()}>{cleanup.isPending ? 'Removing temporary file…' : 'Retry temporary-file cleanup'}</Button></div>}
        <p className="text-sm text-muted-foreground">Creates a tiny synthetic file, checks its contents and signed download, confirms anonymous access is denied, then removes it. Allow up to one minute. Employee files are not used.</p>
        <Button disabled={!data.storage.canVerify || !data.storage.historyAvailable || data.storage.running || busy || !!last?.cleanupKey} onClick={() => check.mutate()}>{check.isPending || data.storage.running ? 'Storage check running — refresh shortly' : 'Verify private storage'}</Button>
        {!data.storage.canVerify && <p className="text-xs text-muted-foreground">This check requires the configured Supabase private-storage provider.</p>}
        {(check.error || cleanup.error) && <p role="alert" className="text-sm text-destructive">{(check.error || cleanup.error)?.message}</p>}
      </article>
    </>}
  </CardContent></Card>;
}
