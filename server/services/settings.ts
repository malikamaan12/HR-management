import { eq } from 'drizzle-orm';
import { appSettings } from '@shared/schema';
import { companySettingsSchema, defaultCompanySettings } from '@shared/settings';
import { db } from '../db';
export async function getCompanySettings(executor:Pick<typeof db,'select'>=db){const [row]=await executor.select().from(appSettings).where(eq(appSettings.key,'company'));return row?companySettingsSchema.parse(row.value):defaultCompanySettings;}
