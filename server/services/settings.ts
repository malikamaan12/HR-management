import { eq } from 'drizzle-orm';
import { appSettings } from '@shared/schema';
import { companySettingsSchema, defaultCompanySettings } from '@shared/settings';
import { db } from '../db';
export async function getCompanySettings(){const [row]=await db.select().from(appSettings).where(eq(appSettings.key,'company'));return row?companySettingsSchema.parse(row.value):defaultCompanySettings;}
