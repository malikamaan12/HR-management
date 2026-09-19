import {z} from 'zod';

export const brandingSchema=z.object({
  applicationName:z.string().trim().min(1).max(60),
  shortName:z.string().trim().min(1).max(8),
  tagline:z.string().trim().max(100),
  pageTitle:z.string().trim().min(1).max(100),
  description:z.string().trim().max(300),
  themeColor:z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();
export type Branding=z.infer<typeof brandingSchema>;
export const defaultBranding:Branding={applicationName:'E3 HR System',shortName:'E3',tagline:'People & operations',pageTitle:'E3 HR & Employee Management System',description:'Employee and workforce management workspace.',themeColor:'#174b49'};
export const assetKeys=['lightLogo','darkLogo','favicon'] as const;
export type BrandingAsset=typeof assetKeys[number];
export type PublicBranding=Branding & {version:number;assets:Partial<Record<BrandingAsset,string>>};
export const defaultPublicBranding:PublicBranding={...defaultBranding,version:0,assets:{}};
export const maxBrandingBytes=512*1024;
