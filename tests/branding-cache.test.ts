import {expect,test} from 'vitest';
import {QueryClient,QueryObserver} from '@tanstack/react-query';
import {clearSessionCache} from '../client/src/lib/queryClient';
test('session changes erase private data while keeping the public branding observer connected',()=>{
 const client=new QueryClient();
 client.setQueryData(['/api/branding'],{applicationName:'Before'});
 client.setQueryData(['/api/employees'],[{private:'employee record'}]);
 client.setQueryData(['/api/branding','private'],{private:'not a public key'});
 const observer=new QueryObserver(client,{queryKey:['/api/branding'],enabled:false});const stop=observer.subscribe(()=>{});
 clearSessionCache(client);
 expect(client.getQueryData(['/api/employees'])).toBeUndefined();expect(client.getQueryData(['/api/branding','private'])).toBeUndefined();
 client.setQueryData(['/api/branding'],{applicationName:'After'});
 expect(observer.getCurrentResult().data).toEqual({applicationName:'After'});
 stop();client.clear();
});
