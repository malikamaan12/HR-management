import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from './AuthContext';
import {apiJson} from '@/lib/queryClient';
import {translate,type Language} from '@shared/localization';
const LocaleContext=createContext({language:'en' as Language,t:(text:string)=>text,setLanguage:async(_language:Language)=>{}});
export function LocaleProvider({children}:{children:ReactNode}){
 const {user}=useAuth(),cache=useQueryClient();
 const [language,setLocal]=useState<Language>(()=>{try{return localStorage.getItem('e3:language')==='ar'?'ar':'en';}catch{return 'en';}});
 const key=['/api/preferences',user?.userId];
 const saved=useQuery<{language:Language}>({queryKey:key,queryFn:()=>apiJson('/api/preferences'),enabled:!!user&&!user.mfaRequired});
 useEffect(()=>{if(saved.data)setLocal(saved.data.language);},[saved.data]);
 useEffect(()=>{document.documentElement.lang=language;document.documentElement.dir=language==='ar'?'rtl':'ltr';try{localStorage.setItem('e3:language',language);}catch{}},[language]);
 const setLanguage=async(value:Language)=>{await cache.cancelQueries({queryKey:key});if(user&&!user.mfaRequired){const result=await apiJson<{language:Language}>('/api/preferences',{method:'PUT',body:{language:value}});cache.setQueryData(key,result);}setLocal(value);};
 return <LocaleContext.Provider value={{language,t:text=>translate(language,text),setLanguage}}>{children}</LocaleContext.Provider>;
}
export const useLocale=()=>useContext(LocaleContext);
