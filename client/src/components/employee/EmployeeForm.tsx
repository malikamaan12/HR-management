import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { employeeWriteFields, checkEmploymentDates } from '@shared/employee-records';
import type { ApiEmployeeRecord, ApiEmployeeDirectory } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

const schema = employeeWriteFields.superRefine((value, context) => {
  const message = checkEmploymentDates(value);
  if (message) context.addIssue({ code: z.ZodIssueCode.custom, path: ['joiningDate'], message });
});
type Values = z.infer<typeof employeeWriteFields>;
type Field = { name: keyof Values; label: string; type?: 'date' | 'email' | 'number' | 'tel'; required?: boolean; options?: readonly string[]; choices?: readonly string[] };
const personal: Field[] = [
  { name: 'employeeId', label: 'Employee ID', required: true },
  { name: 'firstName', label: 'First name', required: true }, { name: 'lastName', label: 'Last name', required: true },
  { name: 'fullNameArabic', label: 'Arabic name' }, { name: 'qidNumber', label: 'QID / identification', required: true },
  { name: 'gender', label: 'Gender', options: ['male', 'female', 'other'], required: true },
  { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true }, { name: 'nationality', label: 'Nationality', required: true },
  { name: 'maritalStatus', label: 'Marital status', options: ['single', 'married', 'divorced', 'widowed'] },
  { name: 'religion', label: 'Religion', options: ['islam', 'christianity', 'hinduism', 'buddhism', 'other'] },
  { name: 'bloodGroup', label: 'Blood group', options: ['a_positive', 'a_negative', 'b_positive', 'b_negative', 'ab_positive', 'ab_negative', 'o_positive', 'o_negative'], choices: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  { name: 'primaryMobile', label: 'Primary mobile', type: 'tel', required: true }, { name: 'secondaryContact', label: 'Secondary contact', type: 'tel' },
  { name: 'personalEmail', label: 'Personal email', type: 'email' },
  { name: 'residentialAddress', label: 'Residential address', required: true }, { name: 'homeCountryAddress', label: 'Home country address' },
];
const employment: Field[] = [
  { name: 'workSchedule', label: 'Work schedule', options: ['unassigned','management_office','shift_based'], choices: ['Not assigned','Management office','Assigned shifts'], required: true },
  { name: 'type', label: 'Employment type', options: ['permanent', 'temporary', 'contract'], required: true },
  { name: 'status', label: 'Status', options: ['active', 'inactive', 'on_leave'], required: true },
  { name: 'department', label: 'Department', required: true }, { name: 'position', label: 'Job title', required: true },
  { name: 'location', label: 'Location', required: true }, { name: 'workLocation', label: 'Work location' },
  { name: 'joiningDate', label: 'Joining date', type: 'date', required: true },
  { name: 'contractEndDate', label: 'Contract end date', type: 'date' }, { name: 'terminationDate', label: 'Termination date', type: 'date' },
  { name: 'workEmail', label: 'Work email', type: 'email' }, { name: 'workPhone', label: 'Work phone', type: 'tel' },
  { name: 'costCenter', label: 'Cost center' }, { name: 'jobGrade', label: 'Job grade' },
  { name: 'employeeCategory', label: 'Employee category', options: ['national', 'expatriate'] },
  { name: 'probationPeriod', label: 'Probation period (months)', type: 'number' }, { name: 'noticePeriod', label: 'Notice period (days)', type: 'number' },
];
const bank: Field[] = [
  { name: 'emergencyContactName', label: 'Emergency contact name', required: true },
  { name: 'emergencyContactNumber', label: 'Emergency contact number', type: 'tel', required: true },
  { name: 'emergencyContactRelation', label: 'Relationship' },
  { name: 'bankName', label: 'Bank name' }, { name: 'accountName', label: 'Account name' },
  { name: 'ibanNumber', label: 'IBAN' }, { name: 'swiftCode', label: 'SWIFT code' }, { name: 'bankBranch', label: 'Bank branch' },
];
const sections = [{ id: 'personal', label: 'Personal', fields: personal }, { id: 'employment', label: 'Employment', fields: employment }, { id: 'bank', label: 'Bank & emergency', fields: bank }];

export default function EmployeeForm({ employee, onSuccess, onCancel, initialValues, submit }: { employee?: ApiEmployeeRecord; onSuccess: () => void; onCancel?: () => void; initialValues?: Partial<Values>; submit?: (values:Values)=>Promise<unknown> }) {
  const [tab, setTab] = useState('personal');
  const [saving, setSaving] = useState(false);
  const [managerSearch, setManagerSearch] = useState('');
  // Keep the version from when editing began, even if the profile query refreshes.
  const [editingVersion] = useState(employee?.recordVersion);
  const [defaults] = useState(() => employee
    ? Object.fromEntries(Object.keys(employeeWriteFields.shape).map(key => [key, employee[key as keyof ApiEmployeeRecord]]))
    : { type: 'permanent', status: 'active', eventStaffEligible: false, workSchedule: 'unassigned',...initialValues });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  const { toast } = useToast();
  const managers = useQuery<ApiEmployeeDirectory>({ queryKey: ['/api/employees/directory', { q: managerSearch.trim(), limit: 50 }], enabled: tab === 'employment' });
  async function save(values: Values) {
    setSaving(true);
    try {
      if(submit)await submit(values);else await apiRequest(employee ? `/api/employees/${employee.id}` : '/api/employees', {
        method: employee ? 'PATCH' : 'POST', body: { ...values, ...(employee ? { expectedVersion: editingVersion } : {}) },
      });
      await queryClient.invalidateQueries({ predicate: query => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/employees') });
      toast({ title: employee ? 'Employee updated' : 'Employee added', description: `${values.firstName} ${values.lastName} saved successfully.` });
      onSuccess();
    } catch (error) {
      toast({ title: 'Unable to save employee', description: error instanceof Error ? error.message : 'Try again', variant: 'destructive' });
    } finally { setSaving(false); }
  }
  return <Form {...form}><form noValidate onSubmit={form.handleSubmit(save, errors => {
    const first = Object.keys(errors)[0];
    setTab(sections.find(section => section.fields.some(field => field.name === first))?.id || 'employment');
    toast({ title: 'Check employee details', description: 'Complete the highlighted fields before saving.', variant: 'destructive' });
  })} className="space-y-5">
    <p className="text-sm text-muted-foreground">Fields marked * are required. Leave optional details blank when they have not been provided.</p>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="grid w-full grid-cols-3">{sections.map(section => <TabsTrigger key={section.id} value={section.id}>{section.label}</TabsTrigger>)}</TabsList>
      {sections.map(section => <TabsContent key={section.id} value={section.id} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">{section.fields.map(item => <FormField key={item.name} control={form.control} name={item.name} render={({ field }) => <FormItem>
          <FormLabel>{item.label}{item.required ? ' *' : ''}</FormLabel>
          <FormControl>{item.options
            ? <select className="h-10 w-full rounded-md border bg-background px-3" name={field.name} ref={field.ref} onBlur={field.onBlur} value={String(field.value ?? '')} onChange={event => field.onChange(event.target.value || (item.required ? undefined : null))}>
              <option value="">{item.required ? 'Select...' : 'Not recorded'}</option>{item.options.map((value, i) => <option key={value} value={value}>{item.choices?.[i] || value.replaceAll('_', ' ')}</option>)}
            </select>
            : <Input name={field.name} ref={field.ref} onBlur={field.onBlur} type={item.type || 'text'} value={String(field.value ?? '')} min={item.type === 'number' ? 0 : undefined} step={item.type === 'number' ? 1 : undefined}
              onChange={event => field.onChange(event.target.value === '' ? item.required ? '' : null : item.type === 'number' ? event.target.valueAsNumber : event.target.value)} />}
          </FormControl><FormMessage />
        </FormItem>} />)}</div>
        {section.id === 'employment' && <div className="space-y-4 border-t pt-4">
          <FormField control={form.control} name="eventStaffEligible" render={({field}) => <FormItem className="flex items-center gap-3 space-y-0"><FormControl><input type="checkbox" name={field.name} ref={field.ref} onBlur={field.onBlur} checked={!!field.value} onChange={event => field.onChange(event.target.checked)} /></FormControl><FormLabel>Eligible for event staffing</FormLabel><FormMessage /></FormItem>} />
          <div><label htmlFor="manager-search" className="text-sm font-medium">Find a reporting manager</label><Input id="manager-search" className="mt-2" value={managerSearch} placeholder="Search name or employee ID" onChange={event => setManagerSearch(event.target.value)} /></div>
          {managers.error && <p role="alert" className="text-sm text-destructive">Unable to load managers. <button type="button" className="underline" onClick={() => managers.refetch()}>Retry</button></p>}
          <div className="grid gap-4 sm:grid-cols-2">{(['reportingManagerId', 'secondaryManagerId'] as const).map(name => <FormField key={name} control={form.control} name={name} render={({field}) => <FormItem>
            <FormLabel>{name === 'reportingManagerId' ? 'Primary manager' : 'Secondary manager'}</FormLabel><FormControl>
              <select className="h-10 w-full rounded-md border bg-background px-3" name={field.name} ref={field.ref} value={String(field.value ?? '')} onBlur={field.onBlur} onChange={event => field.onChange(event.target.value ? Number(event.target.value) : null)}>
                <option value="">No manager</option>
                {field.value && !managers.data?.employees.some(manager => manager.id === field.value && manager.status !== 'inactive') && <option value={String(field.value)}>Current manager #{field.value}</option>}
                {managers.data?.employees.filter(manager => manager.id !== employee?.id && manager.status !== 'inactive').map(manager => <option key={manager.id} value={manager.id}>{manager.firstName} {manager.lastName} · {manager.employeeId}</option>)}
              </select>
            </FormControl><FormMessage />
          </FormItem>} />)}</div>
          <p className="text-sm text-muted-foreground">Search to find managers beyond the first 50 results. FEC and event teams are assigned in Workforce Operations.</p>
        </div>}
      </TabsContent>)}
    </Tabs>
    <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
      <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
      <div className="flex gap-2">{tab !== 'personal' && <Button type="button" variant="outline" disabled={saving} onClick={() => setTab(tab === 'bank' ? 'employment' : 'personal')}>Back</Button>}
        {tab !== 'bank' ? <Button key="next" type="button" onClick={event => { event.preventDefault(); setTab(tab === 'personal' ? 'employment' : 'bank'); }}>Next</Button> : <Button key="save" type="submit" disabled={saving}>{saving ? 'Saving...' : employee ? 'Update Employee' : 'Add Employee'}</Button>}
      </div>
    </div>
  </form></Form>;
}
