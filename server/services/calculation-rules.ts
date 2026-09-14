import {and,desc,eq,lte} from 'drizzle-orm';
import {db} from '../db';
import {appSettings,calculationRuleVersions} from '@shared/schema';
import {companySettingsSchema,defaultCompanySettings} from '@shared/settings';
import {calculationRulesSchema,defaultCalculationRules,ruleScope,type RuleScope,type CalculationSnapshot} from '@shared/calculation-rules';
import type {WorkforceTransaction} from './workforce';

export async function calculationSnapshot(employee:{workSchedule?:string|null},date:string,tx:WorkforceTransaction|typeof db=db,legacy=false):Promise<CalculationSnapshot>{
 const scope=ruleScope(employee);
 const [company]=await tx.select().from(appSettings).where(eq(appSettings.key,'company'));
 const calendar=company?companySettingsSchema.parse(company.value):defaultCompanySettings;
 const [version]=legacy?[]:await tx.select().from(calculationRuleVersions)
  .where(and(eq(calculationRuleVersions.scope,scope),lte(calculationRuleVersions.effectiveFrom,date)))
  .orderBy(desc(calculationRuleVersions.effectiveFrom),desc(calculationRuleVersions.id)).limit(1);
 return {scope,version:version?.id||0,effectiveFrom:version?.effectiveFrom||null,rules:version?calculationRulesSchema.parse(version.rules):structuredClone(defaultCalculationRules),
  calendar:{weekendDays:calendar.weekendDays,managementOfficeSchedule:calendar.managementOfficeSchedule}};
}
export async function ruleHistory(scope:RuleScope,tx:WorkforceTransaction|typeof db=db){
 return tx.select().from(calculationRuleVersions).where(eq(calculationRuleVersions.scope,scope)).orderBy(desc(calculationRuleVersions.id)).limit(100);
}
