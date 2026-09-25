import {test,expect,afterEach,vi} from 'vitest';
import {applicationDataMode,paymentModeError} from '../server/services/data-mode';
afterEach(()=>vi.unstubAllEnvs());
test('production requires an explicit data mode before financial operations',()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('APP_DATA_MODE','');expect(applicationDataMode()).toBe('unconfirmed');expect(paymentModeError()).toContain('Confirm');vi.stubEnv('APP_DATA_MODE','demo');expect(paymentModeError()).toContain('disabled');vi.stubEnv('APP_DATA_MODE','operational');expect(paymentModeError()).toBeNull();});
test('demo payments are blocked in every environment',()=>{vi.stubEnv('NODE_ENV','test');vi.stubEnv('APP_DATA_MODE','demo');expect(paymentModeError()).toContain('demo');});
