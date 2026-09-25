import {expect,test} from 'vitest';
import {pages} from '../shared/navigation';
import {arabic,translate,languageLocale} from '../shared/localization';
test('Arabic catalog covers every visible navigation destination and section',()=>{for(const page of pages.filter(p=>!p.hidden)){expect(arabic[page.label],page.label).toBeTruthy();expect(arabic[page.section],page.section).toBeTruthy();}});
test('untranslated content is preserved and locale selection is explicit',()=>{expect(translate('en','Payroll')).toBe('Payroll');expect(translate('ar','Payroll')).toBe('الرواتب');expect(translate('ar','Synthetic employee')).toBe('Synthetic employee');expect(languageLocale('ar')).toBe('ar-QA');});
