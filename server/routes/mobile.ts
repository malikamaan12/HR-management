import attendanceRoutes from './attendance';
import leaveRoutes from './leaveRequests';
import { documentUpload, createDocument } from './documents';
import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { eq, and, gte, lte, isNotNull, desc } from 'drizzle-orm';
import { storage } from '../storage';
import { authenticate } from '../middleware/auth';
import { authService } from '../services/auth';
import { z } from 'zod';
import { insertLeaveSchema, type InsertAttendance } from '@shared/schema';
import { employees, attendance, documents, leaves, shiftSchedules, users } from '@shared/schema';
import multer from 'multer';
import path from 'path';
import { format } from 'date-fns';
import jwt from 'jsonwebtoken';
import {rateLimit} from 'express-rate-limit';
import {loginRateLimit} from '../middleware/security';

const router = Router();


// Middleware for JWT verification
export const verifyJWT = authenticate;

// Rate limiting middleware
export const rateLimiter = (limit: number, timeWindow: number) => rateLimit({limit, windowMs:timeWindow,
  standardHeaders:'draft-8', legacyHeaders:false, message:{message:'Too many requests, please try again later'}});

// Apply rate limiting to all mobile endpoints: 60 requests per minute
router.use(rateLimiter(60, 60 * 1000));
router.use('/leave-request',leaveRoutes);

// Authentication endpoint - generate JWT token
router.post('/auth/login', loginRateLimit, async (req: Request, res: Response) => {
  const input=z.object({username:z.string().trim().min(1).max(254),password:z.string().min(1).max(1024)}).safeParse(req.body);
  if(!input.success)return res.status(400).json({message:'Username and password are required'});
  try { const session=await authService.login(input.data.username,input.data.password,req.ip,req.get('user-agent'));
    return res.json({...session,token:session.accessToken});
  } catch { return res.status(401).json({message:'Login failed. Check credentials and account approval.'}); }
});

// Mobile API endpoint to get employee profile
router.get('/employee-profile', verifyJWT, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    
    // Get employee data
    const employeeData = await db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeId: employees.employeeId,
      department: employees.department,
      jobTitle: employees.position,
      profileImage: employees.photo
    })
    .from(employees)
    .where(eq(employees.userId, userId))
    .limit(1);
    
    if (!employeeData || employeeData.length === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Return simplified profile data for mobile
    res.status(200).json({
      id: employeeData[0].id,
      employeeId: employeeData[0].employeeId,
      name: `${employeeData[0].firstName} ${employeeData[0].lastName}`,
      department: employeeData[0].department,
      position: employeeData[0].jobTitle,
      profileImage: employeeData[0].profileImage
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving employee profile', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Mobile API endpoint to get shift schedule for the next 7 days
router.get('/shift-schedule/:employeeId', verifyJWT, async (req: Request, res: Response) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    const userId = req.user!.userId;
    
    // Additional security check to ensure users can only access their own data
    const employee = await db.select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    
    if (!employee || employee.length === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    if (employee[0].userId !== userId && (req as any).user.role !== 'admin' && (req as any).user.role !== 'hr') {
      return res.status(403).json({ message: 'Unauthorized to access this employee data' });
    }
    
    // Get current date and calculate date 7 days from now
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);
    
    const todayStr = format(today, 'yyyy-MM-dd');
    const nextWeekStr = format(nextWeek, 'yyyy-MM-dd');
    
    // Query shift schedules for the next 7 days
    const shifts = await db.select({
      id: shiftSchedules.id,
      date: shiftSchedules.date,
      shiftName: shiftSchedules.shiftName,
      startTime: shiftSchedules.startTime,
      endTime: shiftSchedules.endTime,
      location: shiftSchedules.location,
      notes: shiftSchedules.notes
    })
    .from(shiftSchedules)
    .where(
      eq(shiftSchedules.employeeId, employeeId)
      // Add date range filter here once we fix schema issues
    );
    
    // Format for mobile consumption
    const formattedShifts = shifts.map(shift => ({
      id: shift.id,
      date: shift.date,
      shift: shift.shiftName,
      time: `${new Date(shift.startTime).toLocaleTimeString()} - ${new Date(shift.endTime).toLocaleTimeString()}`,
      location: shift.location,
      notes: shift.notes
    }));
    
    res.status(200).json({
      employeeId,
      shifts: formattedShifts,
      period: {
        from: todayStr,
        to: nextWeekStr
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving shift schedule', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/submit-document',verifyJWT,documentUpload.single('document'),createDocument);

// Mobile API endpoint to get available shifts
router.get('/available-shifts/:employeeId', verifyJWT, async (req: Request, res: Response) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    const userId = req.user!.userId;
    
    // Additional security check to ensure users can only access their own data
    const employee = await db.select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    
    if (!employee || employee.length === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    if (employee[0].userId !== userId && (req as any).user.role !== 'admin' && (req as any).user.role !== 'hr') {
      return res.status(403).json({ message: 'Unauthorized to access this employee data' });
    }
    
    // Get available shifts
    // This would normally involve a more complex query considering employee skills, 
    // qualifications, and availability patterns
    // For this implementation, we'll return a simplified version
    
    // Get current date
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');
    
    // Query available shifts
    // This is a placeholder query - in reality would need to join with employee skills 
    // and qualifications tables and filter by employee department etc.
    const shifts = await db.select({
      id: shiftSchedules.id,
      date: shiftSchedules.date,
      shiftName: shiftSchedules.shiftName,
      startTime: shiftSchedules.startTime,
      endTime: shiftSchedules.endTime,
      location: shiftSchedules.location,
      notes: shiftSchedules.notes
    })
    .from(shiftSchedules)
    .where(
      eq(shiftSchedules.employeeId, 0) // Shifts not assigned to anyone
      // Add date filter for future dates once we fix schema issues
    )
    .limit(10);
    
    // Format for mobile consumption
    const availableShifts = shifts.map(shift => ({
      id: shift.id,
      date: shift.date,
      shift: shift.shiftName,
      time: `${new Date(shift.startTime).toLocaleTimeString()} - ${new Date(shift.endTime).toLocaleTimeString()}`,
      location: shift.location,
      notes: shift.notes
    }));
    
    res.status(200).json({
      employeeId,
      availableShifts,
      count: availableShifts.length
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving available shifts', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Mobile API endpoint to claim a shift
router.post('/claim-shift/:shiftId', verifyJWT, async (req: Request, res: Response) => {
  try {
    const shiftId = parseInt(req.params.shiftId);
    const { employeeId } = req.body;
    
    if (!employeeId) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }
    
    const empId = Number(employeeId);
    if(!Number.isSafeInteger(empId) || empId < 1)return res.status(400).json({message:'Invalid employee ID'});
    const owned=await storage.getEmployee(empId);
    if(!owned || owned.userId !== req.user!.userId)return res.status(403).json({message:'This employee record is not linked to your account'});
    const userId = req.user!.userId;
    
    // Additional security check to ensure users can only access their own data
    const employee = await db.select()
      .from(employees)
      .where(eq(employees.id, empId))
      .limit(1);
    
    if (!employee || employee.length === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    if (employee[0].userId !== userId && (req as any).user.role !== 'admin' && (req as any).user.role !== 'hr') {
      return res.status(403).json({ message: 'Unauthorized to claim shift for this employee' });
    }
    
    // Check if shift exists and is available
    const shift = await db.select()
      .from(shiftSchedules)
      .where(eq(shiftSchedules.id, shiftId))
      .limit(1);
    
    if (!shift || shift.length === 0) {
      return res.status(404).json({ message: 'Shift not found' });
    }
    
    if (shift[0].employeeId !== 0) {
      return res.status(400).json({ message: 'Shift is already assigned to an employee' });
    }
    
    // Update shift to assign to employee
    const [updatedShift] = await db.update(shiftSchedules)
      .set({
        employeeId: empId,
        updatedAt: new Date()
      })
      .where(and(eq(shiftSchedules.id, shiftId),eq(shiftSchedules.employeeId,0)))
      .returning();
    if(!updatedShift)return res.status(409).json({message:'Shift was already claimed'});
    
    // TODO: Send push notification to employee confirming shift claim
    
    res.status(200).json({
      success: true,
      shiftId,
      employeeId: empId,
      message: 'Shift claimed successfully',
      shift: {
        date: updatedShift.date,
        shift: updatedShift.shiftName,
        time: `${new Date(updatedShift.startTime).toLocaleTimeString()} - ${new Date(updatedShift.endTime).toLocaleTimeString()}`,
        location: updatedShift.location
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error claiming shift', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/register-device',verifyJWT,(_req,res)=>res.status(501).json({message:'Push notifications are not configured'}));

router.use('/attendance',attendanceRoutes);

router.get('/attendance/history/:employeeId', verifyJWT, async (req: Request, res: Response) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    const userId = req.user!.userId;
    const { startDate, endDate } = req.query;
    
    // Verify employee belongs to authenticated user
    const employee = await db.select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
      
    if (!employee || employee.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    if (employee[0].userId !== userId && (req as any).user.role !== 'admin' && (req as any).user.role !== 'hr') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized to view attendance for this employee'
      });
    }
    
    // Set default date range if not provided (last 30 days)
    const end = endDate ? new Date(endDate as string) : new Date();
    const start = startDate ? new Date(startDate as string) : new Date();
    start.setDate(start.getDate() - 30);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format for startDate or endDate'
      });
    }
    
    // Get attendance records
    const attendanceRecords = await db.select()
      .from(attendance)
      .where(
        and(
          eq(attendance.employeeId, employeeId),
          gte(attendance.date, start.toISOString()),
          lte(attendance.date, end.toISOString())
        )
      )
      .orderBy(desc(attendance.date));
    
    // Format for mobile consumption
    const formattedRecords = attendanceRecords.map(record => ({
      id: record.id,
      date: record.date,
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      status: record.status,
      hoursWorked: (record.totalWorkHours ?? 0) / 60,
      isComplete: !!record.checkIn && !!record.checkOut
    }));
    
    res.status(200).json({
      success: true,
      employeeId,
      period: {
        from: start.toISOString().split('T')[0],
        to: end.toISOString().split('T')[0]
      },
      attendanceRecords: formattedRecords,
      count: formattedRecords.length
    });
  } catch (error) {
    console.error('Attendance history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving attendance history',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
