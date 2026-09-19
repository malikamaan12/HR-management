import {test,expect} from 'vitest';
import {payPeriod,serviceAnniversary} from '../shared/hr-rules';
test('payday on the first selects the completed 28th to 27th cycle across year and leap boundaries',()=>{
 expect(payPeriod(2026,10,28,1)).toEqual({start:'2026-08-28',end:'2026-09-27'});
 expect(payPeriod(2026,1,28,1)).toEqual({start:'2025-11-28',end:'2025-12-27'});
 expect(payPeriod(2024,3,28,1)).toEqual({start:'2024-01-28',end:'2024-02-27'});
 expect(payPeriod(2026,10,28,28)).toEqual({start:'2026-09-28',end:'2026-10-27'});
 expect(payPeriod(2026,10,1,1)).toEqual({start:'2026-09-01',end:'2026-09-30'});
});
test('completed service years use anniversaries including leap-day joiners',()=>{
 expect(serviceAnniversary('2024-02-29',1)).toBe('2025-02-28');
 expect(serviceAnniversary('2024-09-19',1)).toBe('2025-09-19');
});
