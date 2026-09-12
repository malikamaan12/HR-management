import { randomUUID } from 'node:crypto';
import { db } from "../db";
import { employees, users, bulkImportJobs } from "@shared/schema";
import { eq } from "drizzle-orm";
import Papa from "papaparse";
import bcrypt from "bcryptjs";

interface BulkImportRow {
  firstName: string;
  lastName: string;
  email: string;
  gender: 'male' | 'female' | 'other';
  dateOfBirth: string;
  nationality: string;
  qidNumber: string;
  primaryMobile: string;
  residentialAddress: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  department: string;
  position: string;
  location: string;
  joiningDate: string;
  username?: string;
  password?: string;
  role?: 'admin' | 'hr' | 'finance' | 'employee' | 'temporary_staff' | 'manager' | 'department_head';
  type: 'permanent' | 'temporary' | 'contract';
}

interface ImportResult {
  success: boolean;
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  errors: Array<{ row: number; field: string; message: string; data: any }>;
}

export class BulkImportService {
  async processBulkImport(
    jobId: number,
    csvContent: string,
    uploadedBy: number
  ): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      totalRows: 0,
      successfulRows: 0,
      failedRows: 0,
      errors: [],
    };

    try {
      // Parse CSV content
      const parseResult = Papa.parse<BulkImportRow>(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => {
          // Transform common header variations to match our schema
          const headerMap: { [key: string]: string } = {
            'first_name': 'firstName',
            'last_name': 'lastName',
            'date_of_birth': 'dateOfBirth',
            'qid_number': 'qidNumber',
            'primary_mobile': 'primaryMobile',
            'residential_address': 'residentialAddress',
            'emergency_contact_name': 'emergencyContactName',
            'emergency_contact_number': 'emergencyContactNumber',
            'joining_date': 'joiningDate',
            'employee_type': 'type',
          };
          return headerMap[header.toLowerCase()] || header;
        },
      });

      if (parseResult.errors.length > 0) {
        result.errors.push(...parseResult.errors.map((error, index) => ({
          row: index,
          field: 'csv_parse',
          message: error.message,
          data: error,
        })));
      }

      const rows = parseResult.data;
      if(rows.length>500)throw new Error('Import at most 500 rows per file');
      if(parseResult.errors.length)throw new Error('CSV contains invalid rows; correct the file before importing');
      result.totalRows = rows.length;

      // Update job status
      await db.update(bulkImportJobs)
        .set({ 
          status: 'processing',
          totalRows: result.totalRows 
        })
        .where(eq(bulkImportJobs.id, jobId));

      // Process each row
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
          await this.processEmployeeRow(row, i + 1);
          result.successfulRows++;
        } catch (error: any) {
          result.failedRows++;
          result.errors.push({
            row: i + 1,
            field: 'general',
            message: error.message || 'Unknown error',
            data: null,
          });
        }
      }

      // Update final job status
      result.success = result.failedRows === 0;
      await db.update(bulkImportJobs)
        .set({
          status: result.success ? 'completed' : 'failed',
          successfulRows: result.successfulRows,
          failedRows: result.failedRows,
          errorLog: result.errors,
          completedAt: new Date(),
        })
        .where(eq(bulkImportJobs.id, jobId));

    } catch (error: any) {
      // Update job as failed
      await db.update(bulkImportJobs)
        .set({
          status: 'failed',
          errorLog: [{ row: 0, field: 'system', message: error.message, data: null }],
          completedAt: new Date(),
        })
        .where(eq(bulkImportJobs.id, jobId));
      
      throw error;
    }

    return result;
  }

  private async processEmployeeRow(row: BulkImportRow, rowNumber: number): Promise<void> {
    // Validate required fields
    const requiredFields = [
      'firstName', 'lastName', 'email', 'gender', 'dateOfBirth',
      'nationality', 'qidNumber', 'primaryMobile', 'residentialAddress',
      'emergencyContactName', 'emergencyContactNumber', 'department',
      'position', 'location', 'joiningDate', 'type'
    ];

    for (const field of requiredFields) {
      if (!row[field as keyof BulkImportRow]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(row.email)) {
      throw new Error('Invalid email format');
    }

    // Validate QID format (assuming Qatar ID format)
    if (!/^\d{11}$/.test(row.qidNumber)) {
      throw new Error('QID number must be 11 digits');
    }

    // Validate date formats
    const dateFields = ['dateOfBirth', 'joiningDate'];
    for (const field of dateFields) {
      const dateValue = row[field as keyof BulkImportRow] as string;
      if (dateValue && isNaN(Date.parse(dateValue))) {
        throw new Error(`Invalid date format for ${field}. Use YYYY-MM-DD format`);
      }
    }

    await db.transaction(async tx=>{
    let userId: number | null = null;

    // Create user account if username is provided
    if (row.username) {
      // Check if user already exists
      const existingUser = await tx.select()
        .from(users)
        .where(eq(users.username, row.username))
        .limit(1);

      if (existingUser.length > 0) {
        throw new Error(`Username '${row.username}' already exists`);
      }

      // Check if email already exists
      const existingEmail = await tx.select()
        .from(users)
        .where(eq(users.email, row.email))
        .limit(1);

      if (existingEmail.length > 0) {
        throw new Error(`Email '${row.email}' already exists in users table`);
      }

      // Hash password
      if(row.role && !['employee','permanent_employee','temporary_staff','contract_employee'].includes(row.role))throw new Error('Create privileged accounts individually in User management');
      const password = row.password;
      if(!password || password.length<12 || Buffer.byteLength(password)>72)throw new Error('An explicit password of at least 12 characters is required');
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user
      const [newUser] = await tx.insert(users).values({
        username: row.username,
        password: hashedPassword,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        role: row.role || 'employee',
        department: row.department,
        qidNumber: row.qidNumber,
        isActive: true,
        isEmailVerified: false,
        approvalStatus: 'approved',
      }).returning({ id: users.id });

      userId = newUser.id;
    }

    // Check if employee with QID already exists
    const existingEmployee = await tx.select()
      .from(employees)
      .where(eq(employees.qidNumber, row.qidNumber))
      .limit(1);

    if (existingEmployee.length > 0) {
      throw new Error(`Employee with QID '${row.qidNumber}' already exists`);
    }

    // Generate employee ID
    const employeeId = await this.generateEmployeeId(row.department);

    // Create employee record
    await tx.insert(employees).values({
      personalEmail:row.email,
      userId: userId,
      employeeId: employeeId,
      firstName: row.firstName,
      lastName: row.lastName,
      gender: row.gender,
      dateOfBirth: row.dateOfBirth,
      nationality: row.nationality,
      qidNumber: row.qidNumber,
      primaryMobile: row.primaryMobile,
      residentialAddress: row.residentialAddress,
      emergencyContactName: row.emergencyContactName,
      emergencyContactNumber: row.emergencyContactNumber,
      type: row.type,
      department: row.department,
      position: row.position,
      location: row.location,
      joiningDate: row.joiningDate,
      status: 'active',
    });
    });
  }

  private async generateEmployeeId(department:string):Promise<string>{return department.replace(/[^a-z]/gi,'').slice(0,3).toUpperCase()+'-'+randomUUID();}

  async getImportJob(jobId: number) {
    const [job] = await db.select()
      .from(bulkImportJobs)
      .where(eq(bulkImportJobs.id, jobId))
      .limit(1);
    
    return job;
  }

  async getImportJobs(uploadedBy: number) {
    return db.select()
      .from(bulkImportJobs)
      .where(eq(bulkImportJobs.uploadedBy, uploadedBy))
      .orderBy(bulkImportJobs.createdAt);
  }
}