import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Helmet} from 'react-helmet';
import {defaultPublicBranding,type PublicBranding} from '@shared/branding';
import {useTheme} from '@/contexts/ThemeContext';
export function useBranding(){return useQuery<PublicBranding>({queryKey:['/api/branding'],refetchInterval:60000});}
export function BrandingHead(){
  const {data=defaultPublicBranding}=useBranding();
  return <Helmet><title>{data.pageTitle}</title><meta name="application-name" content={data.applicationName}/><meta name="description" content={data.description}/><meta name="robots" content="noindex, nofollow"/><meta name="theme-color" content={data.themeColor}/><meta property="og:title" content={data.pageTitle}/><meta property="og:description" content={data.description}/><meta property="og:site_name" content={data.applicationName}/><link rel="icon" type={data.assets.favicon?'image/png':'image/svg+xml'} href={data.assets.favicon||'/api/branding/default-icon.svg'}/></Helmet>;
}
export function BrandLogo({className='h-10 w-12'}:{className?:string}){
  const {data=defaultPublicBranding}=useBranding(),{theme}=useTheme();
  const [failed,setFailed]=useState('');
  const src=theme==='dark'?data.assets.darkLogo||data.assets.lightLogo:data.assets.lightLogo||data.assets.darkLogo;
  return src&&failed!==src?<img src={src} alt={data.applicationName} className={`${className} shrink-0 object-contain`} onError={()=>setFailed(src)}/>:<span aria-label={data.applicationName} className={`${className} inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-1 text-xs font-bold text-primary-foreground`}>{data.shortName}</span>;
}
