import {saveTemplate} from '../services/onboarding-templates';
import {startOnboarding,editOnboarding,changeOnboardingTask,OnboardingError} from '../services/onboarding-workflow';
import { Router } from "express";
import { db } from "../db";
import { 
  onboardingChecklists, 
  checklistTasks, 
  employeeOnboarding, 
  onboardingTasks,
  employees,
  jobOffers,
  insertOnboardingChecklistSchema,
  insertChecklistTaskSchema,
  insertEmployeeOnboardingSchema,
  insertOnboardingTaskSchema
} from "@shared/schema";
import { eq, desc, count, sql, and, or, like } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// Onboarding Checklists (Templates) Routes
router.get('/onboarding-checklists', async (req, res) => {
  try {
    const checklists = await db
      .select({
        id: onboardingChecklists.id,
        version: onboardingChecklists.version,
        name: onboardingChecklists.name,
        description: onboardingChecklists.description,
        departmentSpecific: onboardingChecklists.departmentSpecific,
        employeeTypeSpecific: onboardingChecklists.employeeTypeSpecific,
        createdAt: onboardingChecklists.createdAt,
        taskCount: sql<number>`(
          SELECT COUNT(*) FROM ${checklistTasks} 
          WHERE ${checklistTasks.checklistId} = ${onboardingChecklists.id} AND ${checklistTasks.active} = true
        )`
      })
      .from(onboardingChecklists)
      .orderBy(desc(onboardingChecklists.createdAt));
    
    res.json(checklists);
  } catch (error) {
    console.error('Error fetching onboarding checklists:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding checklists' });
  }
});

router.get('/onboarding-checklists/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const checklist = await db
      .select()
      .from(onboardingChecklists)
      .where(eq(onboardingChecklists.id, id))
      .limit(1);
    
    if (checklist.length === 0) {
      return res.status(404).json({ error: 'Onboarding checklist not found' });
    }
    
    // Get tasks for this checklist
    const tasks = await db
      .select()
      .from(checklistTasks)
      .where(and(eq(checklistTasks.checklistId, id),eq(checklistTasks.active,true)))
      .orderBy(checklistTasks.daysFromStart, checklistTasks.category);
    
    res.json({ ...checklist[0], tasks });
  } catch (error) {
    console.error('Error fetching onboarding checklist:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding checklist' });
  }
});

router.post('/onboarding-checklists',async(req,res)=>{
 try{res.status(201).json(await saveTemplate(null,req.body,req.user!.userId));}catch(error){res.status(error instanceof OnboardingError?error.status:error instanceof z.ZodError?400:500).json({error:error instanceof OnboardingError||error instanceof z.ZodError?error.message:'Unable to save checklist'});}
});
router.put('/onboarding-checklists/:id',async(req,res)=>{
 try{res.json(await saveTemplate(z.coerce.number().int().positive().parse(req.params.id),req.body,req.user!.userId));}catch(error){res.status(error instanceof OnboardingError?error.status:error instanceof z.ZodError?400:500).json({error:error instanceof OnboardingError||error instanceof z.ZodError?error.message:'Unable to save checklist'});}
});
router.get('/onboarding-checklists/:id/history',async(req,res)=>{
 try{const id=z.coerce.number().int().positive().parse(req.params.id);const result=await db.execute(sql`SELECT version, snapshot, created_at FROM onboarding_template_versions WHERE checklist_id = ${id} ORDER BY version DESC LIMIT 100`);res.json(result.rows);}catch{res.status(400).json({error:'Unable to load checklist history'});}
});

// Checklist Tasks Routes
router.get('/checklist-tasks', async (req, res) => {
  try {
    const { checklistId } = req.query;
    
    let query = db.select().from(checklistTasks).where(eq(checklistTasks.active,true)).$dynamic();
    
    if (checklistId) {
      query = query.where(and(eq(checklistTasks.active,true),eq(checklistTasks.checklistId, parseInt(checklistId as string))));
    }
    
    const tasks = await query.orderBy(checklistTasks.daysFromStart, checklistTasks.category);
    
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching checklist tasks:', error);
    res.status(500).json({ error: 'Failed to fetch checklist tasks' });
  }
});

router.post('/checklist-tasks',(_req,res)=>res.status(409).json({error:'Save tasks together through the checklist editor to preserve version history'}));

// Employee Onboarding Routes
router.get('/employee-onboarding', async (req, res) => {
  try {
    const { status, employeeId } = req.query;
    
    let whereConditions = [];
    if (status) {
      whereConditions.push(eq(employeeOnboarding.status, status as string));
    }
    if (employeeId) {
      whereConditions.push(eq(employeeOnboarding.employeeId, parseInt(employeeId as string)));
    }
    
    // Get onboardings without joining employees table since it lacks required columns
    const onboardings = await db
      .select({
        id: employeeOnboarding.id,
        employeeId: employeeOnboarding.employeeId,
        employeeName: sql<string>`(SELECT e.first_name || ' ' || e.last_name FROM employees e WHERE e.id = "employee_onboarding"."employee_id")`,
        checklistId: employeeOnboarding.checklistId,
        updatedAt: employeeOnboarding.updatedAt,
        checklistName: onboardingChecklists.name,
        startDate: employeeOnboarding.startDate,
        endDate: employeeOnboarding.endDate,
        status: employeeOnboarding.status,
        progress: employeeOnboarding.progress,
        notes: employeeOnboarding.notes,
        createdAt: employeeOnboarding.createdAt,
        completedTasks: sql<number>`(
          SELECT COUNT(*) FROM ${onboardingTasks} 
          WHERE ${onboardingTasks.onboardingId} = ${employeeOnboarding.id} 
          AND ${onboardingTasks.status} = 'completed'
        )`,
        totalTasks: sql<number>`(
          SELECT COUNT(*) FROM ${onboardingTasks} 
          WHERE ${onboardingTasks.onboardingId} = ${employeeOnboarding.id}
        )`
      })
      .from(employeeOnboarding)
      .leftJoin(onboardingChecklists, eq(employeeOnboarding.checklistId, onboardingChecklists.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(employeeOnboarding.createdAt));
    
    res.json(onboardings);
  } catch (error) {
    console.error('Error fetching employee onboardings:', error);
    res.status(500).json({ error: 'Failed to fetch employee onboardings' });
  }
});

router.get('/employee-onboarding/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    const onboarding = await db
      .select({
        id: employeeOnboarding.id,
        employeeId: employeeOnboarding.employeeId,
        employeeName: sql<string>`(SELECT e.first_name || ' ' || e.last_name FROM employees e WHERE e.id = "employee_onboarding"."employee_id")`,
        employeeEmail: sql<string|null>`(SELECT work_email FROM employees WHERE id = ${employeeOnboarding.employeeId})`,
        checklistId: employeeOnboarding.checklistId,
        checklistName: onboardingChecklists.name,
        startDate: employeeOnboarding.startDate,
        endDate: employeeOnboarding.endDate,
        status: employeeOnboarding.status,
        progress: employeeOnboarding.progress,
        notes: employeeOnboarding.notes,
        createdAt: employeeOnboarding.createdAt,
        updatedAt: employeeOnboarding.updatedAt
      })
      .from(employeeOnboarding)
      .leftJoin(onboardingChecklists, eq(employeeOnboarding.checklistId, onboardingChecklists.id))
      .where(eq(employeeOnboarding.id, id))
      .limit(1);
    
    if (onboarding.length === 0) {
      return res.status(404).json({ error: 'Employee onboarding not found' });
    }
    
    // Get all tasks for this onboarding
    const tasks = await db
      .select({
        id: onboardingTasks.id,
        version: onboardingTasks.version,
        reviewRequired: onboardingTasks.reviewRequired,
        reviewState: onboardingTasks.reviewState,
        taskName: checklistTasks.taskName,
        description: checklistTasks.description,
        category: checklistTasks.category,
        assignedTo: onboardingTasks.assignedTo,
        assigneeId: onboardingTasks.assigneeId,
        assigneeName: sql<string|null>`(SELECT first_name || ' ' || last_name FROM employees WHERE id = ${onboardingTasks.assigneeId})`,
        dueDate: onboardingTasks.dueDate,
        completedDate: onboardingTasks.completedDate,
        status: onboardingTasks.status,
        comments: onboardingTasks.comments,
        documentUrl: onboardingTasks.documentUrl,
        daysFromStart: checklistTasks.daysFromStart,
        isRequired: checklistTasks.isRequired
      })
      .from(onboardingTasks)
      .leftJoin(checklistTasks, eq(onboardingTasks.taskId, checklistTasks.id))
      .where(eq(onboardingTasks.onboardingId, id))
      .orderBy(checklistTasks.daysFromStart, checklistTasks.category);
    
    res.json({ ...onboarding[0], tasks });
  } catch (error) {
    console.error('Error fetching employee onboarding:', error);
    res.status(500).json({ error: 'Failed to fetch employee onboarding' });
  }
});

router.post('/employee-onboarding', async (req,res)=>{
 try{res.status(201).json(await startOnboarding(req.body,req.user!.userId));}
 catch(error){res.status(error instanceof OnboardingError?error.status:error instanceof z.ZodError?400:500).json({error:error instanceof OnboardingError||error instanceof z.ZodError?error.message:'Unable to start onboarding'});}
});

router.put('/employee-onboarding/:id',async(req,res)=>{
 try{const id=z.coerce.number().int().positive().parse(req.params.id);res.json(await editOnboarding(id,req.body,req.user!.userId));}
 catch(error){res.status(error instanceof OnboardingError?error.status:error instanceof z.ZodError?400:500).json({message:error instanceof OnboardingError?error.message:error instanceof z.ZodError?'Only notes or cancellation with a reason and current version can be saved':'Unable to edit onboarding'});}
});
router.get('/employee-onboarding/:id/history',async(req,res)=>{
 try{const id=z.coerce.number().int().positive().parse(req.params.id);const rows=await db.execute(sql`SELECT version,actor_id,reason,created_at,snapshot FROM lifecycle_history WHERE kind='onboarding_edit' AND record_id=${id} ORDER BY version DESC LIMIT 50`);res.json(rows.rows);}
 catch{res.status(400).json({message:'Unable to load onboarding history'});}
});
router.put('/checklist-tasks/:id',(_req,res)=>res.status(409).json({message:'Edit tasks through the versioned checklist editor'}));

// Onboarding Tasks Routes
router.post('/onboarding-tasks',(_req,res)=>res.status(409).json({message:'Start onboarding from a checklist so task ownership and review policy are applied together'}));
router.get('/onboarding-tasks', async (req, res) => {
  try {
    const { onboardingId, status, assignedTo } = req.query;
    
    let whereConditions = [];
    if (onboardingId) {
      whereConditions.push(eq(onboardingTasks.onboardingId, parseInt(onboardingId as string)));
    }
    if (status) {
      whereConditions.push(eq(onboardingTasks.status, z.enum(["not_started","in_progress","completed","overdue"]).parse(status)));
    }
    if (assignedTo) {
      whereConditions.push(eq(onboardingTasks.assignedTo, assignedTo as string));
    }
    
    const tasks = await db
      .select({
        id: onboardingTasks.id,
        version: onboardingTasks.version,
        reviewRequired: onboardingTasks.reviewRequired,
        reviewState: onboardingTasks.reviewState,
        onboardingId: onboardingTasks.onboardingId,
        employeeName: sql<string>`(SELECT e.first_name || ' ' || e.last_name FROM employees e WHERE e.id = "employee_onboarding"."employee_id")`,
        taskName: checklistTasks.taskName,
        description: checklistTasks.description,
        category: checklistTasks.category,
        assignedTo: onboardingTasks.assignedTo,
        assigneeId: onboardingTasks.assigneeId,
        assigneeName: sql<string|null>`(SELECT first_name || ' ' || last_name FROM employees WHERE id = ${onboardingTasks.assigneeId})`,
        dueDate: onboardingTasks.dueDate,
        completedDate: onboardingTasks.completedDate,
        status: onboardingTasks.status,
        comments: onboardingTasks.comments,
        documentUrl: onboardingTasks.documentUrl,
        isRequired: checklistTasks.isRequired
      })
      .from(onboardingTasks)
      .leftJoin(checklistTasks, eq(onboardingTasks.taskId, checklistTasks.id))
      .leftJoin(employeeOnboarding, eq(onboardingTasks.onboardingId, employeeOnboarding.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(onboardingTasks.dueDate);
    
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching onboarding tasks:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding tasks' });
  }
});

router.put('/onboarding-tasks/:id',async(req,res)=>{
 try{const id=z.coerce.number().int().positive().parse(req.params.id);res.json(await changeOnboardingTask(id,req.body,req.user!.userId));}
 catch(error){res.status(error instanceof OnboardingError?error.status:error instanceof z.ZodError?400:500).json({error:error instanceof OnboardingError||error instanceof z.ZodError?error.message:'Unable to update onboarding task'});}
});

// Dashboard/Stats Routes
router.get('/onboarding-stats', async (req, res) => {
  try {
    const stats = await db
      .select({
        totalOnboardings: count(),
        inProgress: sql<number>`COUNT(CASE WHEN status = 'in_progress' THEN 1 END)`,
        completed: sql<number>`COUNT(CASE WHEN status = 'completed' THEN 1 END)`,
        avgProgress: sql<number>`AVG(progress)`
      })
      .from(employeeOnboarding);
    
    const recentOnboardings = await db
      .select({
        id: employeeOnboarding.id,
        employeeName: sql<string>`(SELECT e.first_name || ' ' || e.last_name FROM employees e WHERE e.id = "employee_onboarding"."employee_id")`,
        startDate: employeeOnboarding.startDate,
        status: employeeOnboarding.status,
        progress: employeeOnboarding.progress
      })
      .from(employeeOnboarding)
      .orderBy(desc(employeeOnboarding.createdAt))
      .limit(5);
    
    const upcomingTasks = await db
      .select({
        id: onboardingTasks.id,
        version: onboardingTasks.version,
        reviewRequired: onboardingTasks.reviewRequired,
        reviewState: onboardingTasks.reviewState,
        taskName: checklistTasks.taskName,
        employeeName: sql<string>`(SELECT e.first_name || ' ' || e.last_name FROM employees e WHERE e.id = "employee_onboarding"."employee_id")`,
        dueDate: onboardingTasks.dueDate,
        assignedTo: onboardingTasks.assignedTo,
        status: onboardingTasks.status
      })
      .from(onboardingTasks)
      .leftJoin(checklistTasks, eq(onboardingTasks.taskId, checklistTasks.id))
      .leftJoin(employeeOnboarding, eq(onboardingTasks.onboardingId, employeeOnboarding.id))
      .where(and(
        eq(onboardingTasks.status, 'not_started'),
        sql`${onboardingTasks.dueDate} >= CURRENT_DATE`,
        sql`${onboardingTasks.dueDate} <= CURRENT_DATE + INTERVAL '7 days'`
      ))
      .orderBy(onboardingTasks.dueDate)
      .limit(10);
    
    res.json({
      ...stats[0],
      recentOnboardings,
      upcomingTasks
    });
  } catch (error) {
    console.error('Error fetching onboarding stats:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding stats' });
  }
});

export default router;
