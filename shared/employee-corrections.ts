import {employeeWriteFields} from './employee-records';
export const correctionFields=employeeWriteFields.pick({primaryMobile:true,personalEmail:true,residentialAddress:true,emergencyContactName:true,emergencyContactNumber:true}).partial().strict();
export const correctionLabels={primaryMobile:'Mobile number',personalEmail:'Personal email',residentialAddress:'Residential address',emergencyContactName:'Emergency contact name',emergencyContactNumber:'Emergency contact number'};
