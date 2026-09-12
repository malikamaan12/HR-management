import { afterEach, expect, test, vi } from 'vitest';
import { apiRequest, apiJson, queryUrl } from '../client/src/lib/queryClient';
afterEach(()=>vi.unstubAllGlobals());
test.each([
  () => apiRequest('/api/employees',{method:'POST',body:{firstName:'Alice'}}),
  () => apiRequest('/api/employees','POST',{firstName:'Alice'}),
  () => apiRequest({url:'/api/employees',method:'POST',data:{firstName:'Alice'}}),
])('preserves method, credentials and JSON body for every caller convention',async(call)=>{
  const fetch=vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch',fetch);
  await call(); const [url,init]=fetch.mock.calls[0];
  expect(url).toBe('/api/employees'); expect(init.method).toBe('POST'); expect(init.credentials).toBe('include');
  expect(JSON.parse(init.body)).toEqual({firstName:'Alice'}); expect(init.headers.get('Content-Type')).toBe('application/json');
});
test('retains document IDs and filters in query URLs',()=>{
  expect(queryUrl(['/api/documents',42])).toBe('/api/documents/42');
  expect(queryUrl(['/api/employees',{type:'temporary',department:'Sales & Events',empty:undefined}])).toBe('/api/employees?type=temporary&department=Sales+%26+Events');
});
test('keeps FormData intact and lets the browser supply its multipart boundary',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch',fetch);
  const body=new FormData();body.append('file',new Blob(['abc']),'test.txt');
  await apiRequest('/api/documents',{method:'POST',body,headers:{'Content-Type':'application/json'}});
  expect(fetch.mock.calls[0][1].body).toBe(body); expect(fetch.mock.calls[0][1].headers.has('Content-Type')).toBe(false);
});
test('surfaces server failures and decodes successful JSON explicitly',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{"error":"Forbidden"}',{status:403})).mockResolvedValueOnce(new Response('{"id":7}')));
  await expect(apiRequest('/api/employees')).rejects.toThrow('403: Forbidden');
  await expect(apiJson('/api/employees')).resolves.toEqual({id:7});
});
