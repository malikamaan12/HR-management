import {sql} from 'drizzle-orm';
import {db} from '../db';
import {fail,type WorkforceTransaction} from './workforce';
import {accrualPolicy,payPolicy} from '@shared/operations-policies';
export type Policy={id:number;kind:'leave'|'timepay';scope:string;effective_from:string;rules:any;reason:string};
export async function operationPolicy(tx:WorkforceTransaction|typeof db,kind:'leave'|'timepay',scope:string,day:string){
 const result=await tx.execute(sql`SELECT * FROM operations_policies WHERE kind=${kind} AND scope=${scope} AND effective_from<=${day}::date ORDER BY effective_from DESC,id DESC LIMIT 1`);
 const row=result.rows[0] as unknown as Policy|undefined;if(!row)fail(409,'Publish an applicable '+kind+' policy before calculating this period');
 return {...row,rules:(kind==='leave'?accrualPolicy:payPolicy).parse(row.rules)};
}
