import { QueryClient, type QueryFunction, type QueryKey } from '@tanstack/react-query';

export interface RequestOptions { url: string; method?: string; headers?: Record<string,string>; body?: unknown; data?: unknown; }
export async function apiRequest(options: RequestOptions | string, init?: Omit<RequestOptions,'url'> | string, data?: unknown): Promise<Response> {
  const request: RequestOptions = typeof options === 'string'
    ? { url: options, ...(typeof init === 'string' ? {method:init,body:data} : init) } : options;
  const value = request.body ?? request.data;
  const multipart = value instanceof FormData;
  const headers = new Headers(request.headers);
  if (!multipart && value !== undefined && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
  if (multipart) headers.delete('Content-Type');
  const response = await fetch(request.url, { method: request.method || 'GET', headers, credentials: 'include',
    body: value === undefined ? undefined : multipart || typeof value === 'string' ? value : JSON.stringify(value) });
  if (!response.ok) {
    const content = await response.text();
    let message = response.statusText;
    try { const error = JSON.parse(content); message = error.message || error.error || message; } catch { /* Keep a readable status for non-JSON errors. */ }
    throw new Error(response.status + ': ' + message);
  }
  return response;
}
export async function apiJson<T>(options: RequestOptions | string, init?: Omit<RequestOptions,'url'> | string, data?: unknown): Promise<T> {
  return (await apiRequest(options,init,data)).json();
}
export function queryUrl(key: QueryKey): string {
  if (typeof key[0] !== 'string' || !key[0].startsWith('/api/')) throw new Error('Invalid API query key');
  let path = key[0]; const params = new URLSearchParams();
  for (const part of key.slice(1)) {
    if (part == null) continue;
    if (typeof part === 'string' || typeof part === 'number') path += '/' + encodeURIComponent(String(part));
    else if (typeof part === 'object') for (const [name,value] of Object.entries(part)) {
      if (value !== undefined && value !== null && value !== '') params.set(name,String(value));
    }
  }
  return path + (params.size ? (path.includes('?') ? '&' : '?') + params.toString() : '');
}
export const getQueryFn: <T>(options: {on401:'returnNull'|'throw'}) => QueryFunction<T> = ({on401}) => async ({queryKey}) => {
  const response = await fetch(queryUrl(queryKey),{credentials:'include'});
  if (response.status === 401 && on401 === 'returnNull') return null;
  if (!response.ok) throw new Error(response.status + ': ' + response.statusText);
  return response.json();
};
export const queryClient = new QueryClient({defaultOptions:{queries:{queryFn:getQueryFn({on401:'throw'}),refetchOnWindowFocus:false,staleTime:30000,retry:false},mutations:{retry:false}}});
// Public branding observers remain mounted through sign-in/out. Clear all private session data.
export function clearSessionCache(client=queryClient){
  client.removeQueries({predicate:query=>query.queryKey.length!==1||query.queryKey[0]!=='/api/branding'});
  client.getMutationCache().clear();
}
