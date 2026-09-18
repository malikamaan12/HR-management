import { eq,desc,and,inArray,or } from 'drizzle-orm';
import { employees,performanceReviews,employeeGoals,employeeFeedback,insertEmployeeGoalSchema,insertEmployeeFeedbackSchema } from '@shared/schema';
import { z } from 'zod';
import { employeeScope } from '../services/access';
import { Express, Request, Response } from 'express';
import { db } from '../db';
import { performanceService } from '../services/performance';
import { hasPermission } from '@shared/permissions';

async function accessibleEmployeeIds(req: Request, permission: 'read' | 'create' | 'update' = 'read') {
  if (!req.user || !hasPermission(req.user.role, 'performance_management', permission)) return [];
  const rows = await db.select({ id: employees.id }).from(employees).where(employeeScope(req.user, 'performance_management', permission));
  return rows.map(row => row.id);
}

async function linkedEmployeeId(req: Request) {
  if (!req.user) return null;
  const [row] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, req.user.userId));
  return row?.id ?? null;
}

async function canAccessEmployee(req: Request, employeeId: number, permission: 'read' | 'create' | 'update' = 'read') {
  if (!req.user || !hasPermission(req.user.role, 'performance_management', permission)) return false;
  const [row] = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), employeeScope(req.user, 'performance_management', permission)));
  return !!row;
}

export function registerPerformanceRoutes(app: Express) {
  app.get('/api/performance/reviews',async(req,res)=>{try{
    const ids=await accessibleEmployeeIds(req); if(!ids.length)return res.json([]);
    const own=await linkedEmployeeId(req);
    const where=own===null?inArray(performanceReviews.employeeId,ids):or(inArray(performanceReviews.employeeId,ids),eq(performanceReviews.reviewerId,own));
    return res.json(await db.select().from(performanceReviews).where(where).orderBy(desc(performanceReviews.createdAt)));
  }catch{return res.status(500).json({message:'Unable to load reviews'});}});
  app.get('/api/performance/goals',async(req,res)=>{try{
    const ids=await accessibleEmployeeIds(req); if(!ids.length)return res.json([]);
    return res.json(await db.select().from(employeeGoals).where(inArray(employeeGoals.employeeId,ids)).orderBy(desc(employeeGoals.createdAt)));
  }catch{return res.status(500).json({message:'Unable to load goals'});}});
  app.get('/api/performance/feedback',async(req,res)=>{try{
    const ids=await accessibleEmployeeIds(req); if(!ids.length)return res.json([]);
    const own=await linkedEmployeeId(req);
    const where=own===null?inArray(employeeFeedback.employeeId,ids):or(inArray(employeeFeedback.employeeId,ids),eq(employeeFeedback.providerId,own));
    return res.json(await db.select().from(employeeFeedback).where(where).orderBy(desc(employeeFeedback.createdAt)));
  }catch{return res.status(500).json({message:'Unable to load feedback'});}});
  app.post('/api/performance/goals',async(req,res)=>{
    try{const data=insertEmployeeGoalSchema.parse({...req.body,employeeId:Number(req.body.employeeId),status:'not_started',progress:0});
      if(data.dueDate<data.startDate)return res.status(400).json({message:'Due date must follow start date'});
      if (!(await canAccessEmployee(req, data.employeeId, 'create'))) return res.status(403).json({message:'You cannot create goals for this employee'});
      const [goal]=await db.insert(employeeGoals).values(data).returning();return res.status(201).json(goal);
    }catch(error){return res.status(error instanceof z.ZodError?400:500).json({message:error instanceof z.ZodError?'Check the goal fields':'Unable to create goal'});}
  });
  app.patch('/api/performance/goals/:id',(_req,res)=>res.status(409).json({message:'Use Goal progress to update status with the current version and evidence'}));
  app.post('/api/performance/feedback',async(req,res)=>{
    try{const [provider]=await db.select({id:employees.id}).from(employees).where(eq(employees.userId,req.user!.userId));
      if(!provider)return res.status(400).json({message:'Link your account to an employee to provide feedback'});
      const target=Number(req.body.employeeId);
      if (!(await canAccessEmployee(req, target, 'create'))) return res.status(403).json({message:'You cannot provide feedback for this employee'});
      const input=insertEmployeeFeedbackSchema.parse({...req.body,employeeId:target,providerId:provider.id,visibility:'private',feedbackType:req.body.feedbackType==='positive'?'praise':req.body.feedbackType,content:[req.body.subject,req.body.content].filter(Boolean).join('\n\n')});
      const [feedback]=await db.insert(employeeFeedback).values(input).returning();return res.status(201).json(feedback);
    }catch(error){return res.status(error instanceof z.ZodError?400:500).json({message:error instanceof z.ZodError?'Check the feedback fields':'Unable to create feedback'});}
  });
  // Get dashboard stats for performance management
  app.get('/api/performance/dashboard-stats', async (req: Request, res: Response) => {
    try {
      const ids = await accessibleEmployeeIds(req);
      if (!ids.length) return res.json({ avgRating: 0, totalReviews: 0, upcomingReviews: 0, performanceTrends: [] });
      const stats = await performanceService.getDashboardStats(ids);
      return res.status(200).json(stats);
    } catch (error) {
      console.error('[API] Error fetching performance dashboard stats:', error);
      return res.status(500).json({ error: 'Failed to fetch performance dashboard statistics' });
    }
  });

  // Get performance reviews for an employee
  app.get('/api/performance/employee/:id/reviews', async (req: Request, res: Response) => {
    try {
      const employeeId = parseInt(req.params.id);
      if (isNaN(employeeId)) {
        return res.status(400).json({ error: 'Invalid employee ID' });
      }

      if (!(await canAccessEmployee(req, employeeId, 'read'))) return res.status(404).json({ error: 'Review not found' });

      const reviews = await performanceService.getEmployeeReviews(employeeId);
      return res.status(200).json(reviews);
    } catch (error) {
      console.error('[API] Error fetching employee reviews:', error);
      return res.status(500).json({ error: 'Failed to fetch employee performance reviews' });
    }
  });

  // Create a new performance review
  app.post('/api/performance/reviews', async (req: Request, res: Response) => {
    try {
      const [reviewer]=await db.select({id:employees.id}).from(employees).where(eq(employees.userId,req.user!.userId));
      if(!reviewer)return res.status(400).json({message:'Link your account to an employee before reviewing staff'});
      const reviewData = {...req.body,employeeId:Number(req.body.employeeId),reviewerId:reviewer.id};
      if (!(await canAccessEmployee(req, reviewData.employeeId, 'create'))) return res.status(403).json({message:'You cannot create a review for this employee'});
      const newReview = await performanceService.createReview(reviewData);
      return res.status(201).json(newReview);
    } catch (error) {
      console.error('[API] Error creating performance review:', error);
      return res.status(500).json({ error: 'Failed to create performance review' });
    }
  });

  // Get details for a specific performance review
  app.get('/api/performance/reviews/:id', async (req: Request, res: Response) => {
    try {
      const reviewId = parseInt(req.params.id);
      if (isNaN(reviewId)) {
        return res.status(400).json({ error: 'Invalid review ID' });
      }

      const review = await performanceService.getReviewDetails(reviewId);
      if (!review) {
        return res.status(404).json({ error: 'Review not found' });
      }

      const own = await linkedEmployeeId(req);
      if (!(await canAccessEmployee(req, review.review.employeeId, 'read')) && review.review.reviewerId !== own) return res.status(404).json({ error: 'Review not found' });

      return res.status(200).json(review);
    } catch (error) {
      console.error('[API] Error fetching review details:', error);
      return res.status(500).json({ error: 'Failed to fetch review details' });
    }
  });

  // Update a performance review
  app.patch('/api/performance/reviews/:id', async (req: Request, res: Response) => {
    try {
      const reviewId = parseInt(req.params.id);
      if (isNaN(reviewId)) {
        return res.status(400).json({ error: 'Invalid review ID' });
      }

      const existing = await performanceService.getReviewDetails(reviewId);
      if (!existing) return res.status(404).json({ error: 'Review not found' });
      const own = await linkedEmployeeId(req);
      if (!(await canAccessEmployee(req, existing.review.employeeId, 'update')) && existing.review.reviewerId !== own) return res.status(403).json({ error: 'You cannot update this review' });
      const reviewData = req.body;
      const updatedReview = await performanceService.updateReview(reviewId, reviewData);
      return res.status(200).json(updatedReview);
    } catch (error) {
      console.error('[API] Error updating review:', error);
      return res.status(500).json({ error: 'Failed to update review' });
    }
  });
}
