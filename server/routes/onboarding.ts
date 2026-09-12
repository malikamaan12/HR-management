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
        name: onboardingChecklists.name,
        description: onboardingChecklists.description,
        departmentSpecific: onboardingChecklists.departmentSpecific,
        employeeTypeSpecific: onboardingChecklists.employeeTypeSpecific,
        createdAt: onboardingChecklists.createdAt,
        taskCount: sql<number>`(
          SELECT COUNT(*) FROM ${checklistTasks} 
          WHERE ${checklistTasks.checklistId} = ${onboardingChecklists.id}
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
      .where(eq(checklistTasks.checklistId, id))
      .orderBy(checklistTasks.daysFromStart, checklistTasks.category);
    
    res.json({ ...checklist[0], tasks });
  } catch (error) {
    console.error('Error fetching onboarding checklist:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding checklist' });
  }
});

router.post('/onboarding-checklists', async (req, res) => {
  try {
    const validatedData = insertOnboardingChecklistSchema.parse(req.body);
    
    const result = await db
      .insert(onboardingChecklists)
      .values(validatedData)
      .returning();
    
    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Error creating onboarding checklist:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create onboarding checklist' });
  }
});

// Checklist Tasks Routes
router.get('/checklist-tasks', async (req, res) => {
  try {
    const { checklistId } = req.query;
    
    let query = db.select().from(checklistTasks).$dynamic();
    
    if (checklistId) {
      query = query.where(eq(checklistTasks.checklistId, parseInt(checklistId as string)));
    }
    
    const tasks = await query.orderBy(checklistTasks.daysFromStart, checklistTasks.category);
    
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching checklist tasks:', error);
    res.status(500).json({ error: 'Failed to fetch checklist tasks' });
  }
});

router.post('/checklist-tasks', async (req, res) => {
  try {
    const validatedData = insertChecklistTaskSchema.parse(req.body);
    
    const result = await db
      .insert(checklistTasks)
      .values(validatedData)
      .returning();
    
    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Error creating checklist task:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create checklist task' });
  }
});

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
        employeeName: sql<string>`'Employee ' || ${employeeOnboarding.employeeId}`,
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
        employeeName: sql<string>`'Employee ' || ${employeeOnboarding.employeeId}`,
        employeeEmail: sql<string>`'employee' || ${employeeOnboarding.employeeId} || '@company.com'`,
        checklistId: employeeOnboarding.checklistId,
        checklistName: onboardingChecklists.name,
        startDate: employeeOnboarding.startDate,
        endDate: employeeOnboarding.endDate,
        status: employeeOnboarding.status,
        progress: employeeOnboarding.progress,
        notes: employeeOnboarding.notes,
        createdAt: employeeOnboarding.createdAt
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
        taskName: checklistTasks.taskName,
        description: checklistTasks.description,
        category: checklistTasks.category,
        assignedTo: onboardingTasks.assignedTo,
        assigneeId: onboardingTasks.assigneeId,
        assigneeName: sql<string>`'Assignee ' || ${onboardingTasks.assigneeId}`,
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

router.post('/employee-onboarding', async (req, res) => {
  try {
    const validatedData = insertEmployeeOnboardingSchema.parse(req.body);
    
    // Create the onboarding record
    const onboardingResult = await db
      .insert(employeeOnboarding)
      .values(validatedData)
      .returning();
    
    const newOnboarding = onboardingResult[0];
    
    // Get the checklist tasks and create onboarding tasks
    const checklistTasksList = await db
      .select()
      .from(checklistTasks)
      .where(eq(checklistTasks.checklistId, validatedData.checklistId));
    
    if (checklistTasksList.length > 0) {
      const startDate = new Date(validatedData.startDate);
      const onboardingTasksData = checklistTasksList.map(task => {
        const dueDate = new Date(startDate);
        dueDate.setDate(dueDate.getDate() + task.daysFromStart);
        
        return {
          onboardingId: newOnboarding.id,
          taskId: task.id,
          assignedTo: task.assignedTo,
          dueDate: dueDate.toISOString().split('T')[0],
          status: 'not_started' as const
        };
      });
      
      await db.insert(onboardingTasks).values(onboardingTasksData);
    }
    
    res.status(201).json(newOnboarding);
  } catch (error) {
    console.error('Error creating employee onboarding:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create employee onboarding' });
  }
});

// Onboarding Tasks Routes
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
        onboardingId: onboardingTasks.onboardingId,
        employeeName: sql<string>`'Employee ' || ${employeeOnboarding.employeeId}`,
        taskName: checklistTasks.taskName,
        description: checklistTasks.description,
        category: checklistTasks.category,
        assignedTo: onboardingTasks.assignedTo,
        assigneeId: onboardingTasks.assigneeId,
        assigneeName: sql<string>`'Assignee ' || ${onboardingTasks.assigneeId}`,
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

router.put('/onboarding-tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, comments, documentUrl, assigneeId } = req.body;
    
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (comments !== undefined) updateData.comments = comments;
    if (documentUrl !== undefined) updateData.documentUrl = documentUrl;
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId;
    
    if (status === 'completed') {
      updateData.completedDate = new Date().toISOString().split('T')[0];
    }
    
    updateData.updatedAt = new Date();
    
    const result = await db
      .update(onboardingTasks)
      .set(updateData)
      .where(eq(onboardingTasks.id, id))
      .returning();
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Onboarding task not found' });
    }
    
    // Update overall onboarding progress
    const task = result[0];
    await updateOnboardingProgress(task.onboardingId);
    
    res.json(result[0]);
  } catch (error) {
    console.error('Error updating onboarding task:', error);
    res.status(500).json({ error: 'Failed to update onboarding task' });
  }
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
        employeeName: sql<string>`'Employee ' || ${employeeOnboarding.employeeId}`,
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
        taskName: checklistTasks.taskName,
        employeeName: sql<string>`'Employee ' || ${employeeOnboarding.employeeId}`,
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

// Helper function to update onboarding progress
async function updateOnboardingProgress(onboardingId: number) {
  try {
    const taskStats = await db
      .select({
        total: count(),
        completed: sql<number>`COUNT(CASE WHEN status = 'completed' THEN 1 END)`
      })
      .from(onboardingTasks)
      .where(eq(onboardingTasks.onboardingId, onboardingId));
    
    const { total, completed } = taskStats[0];
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    await db
      .update(employeeOnboarding)
      .set({ 
        progress,
        status: progress === 100 ? 'completed' : 'in_progress',
        endDate: progress === 100 ? new Date().toISOString().split('T')[0] : null,
        updatedAt: new Date()
      })
      .where(eq(employeeOnboarding.id, onboardingId));
  } catch (error) {
    console.error('Error updating onboarding progress:', error);
  }
}

export default router;