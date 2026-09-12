import { eq,desc,and } from 'drizzle-orm';
import { employees,performanceReviews,employeeGoals,employeeFeedback,insertEmployeeGoalSchema,insertEmployeeFeedbackSchema } from '@shared/schema';
import { z } from 'zod';
import { employeeScope } from '../services/access';
import { Express, Request, Response } from 'express';
import { db } from '../db';
import { performanceService } from '../services/performance';

export function registerPerformanceRoutes(app: Express) {
  app.get('/api/performance/reviews',async(req,res)=>{try{return res.json(await db.select().from(performanceReviews).orderBy(desc(performanceReviews.createdAt)));}catch{return res.status(500).json({message:'Unable to load reviews'});}});
  app.get('/api/performance/goals',async(req,res)=>{try{return res.json(await db.select().from(employeeGoals).orderBy(desc(employeeGoals.createdAt)));}catch{return res.status(500).json({message:'Unable to load goals'});}});
  app.get('/api/performance/feedback',async(req,res)=>{try{return res.json(await db.select().from(employeeFeedback).orderBy(desc(employeeFeedback.createdAt)));}catch{return res.status(500).json({message:'Unable to load feedback'});}});
  app.post('/api/performance/goals',async(req,res)=>{
    try{const data=insertEmployeeGoalSchema.parse({...req.body,employeeId:Number(req.body.employeeId),status:'not_started',progress:0});
      if(data.dueDate<data.startDate)return res.status(400).json({message:'Due date must follow start date'});
      const [goal]=await db.insert(employeeGoals).values(data).returning();return res.status(201).json(goal);
    }catch{return res.status(400).json({message:'Check the goal fields'});}
  });
  app.patch('/api/performance/goals/:id',async(req,res)=>{
    try{const id=z.coerce.number().int().positive().parse(req.params.id),data=insertEmployeeGoalSchema.omit({employeeId:true}).partial().parse(req.body);
      const [goal]=await db.update(employeeGoals).set({...data,updatedAt:new Date()}).where(eq(employeeGoals.id,id)).returning();
      if(!goal)return res.status(404).json({message:'Goal not found'});return res.json(goal);
    }catch{return res.status(400).json({message:'Check the goal fields'});}
  });
  app.post('/api/performance/feedback',async(req,res)=>{
    try{const [provider]=await db.select({id:employees.id}).from(employees).where(eq(employees.userId,req.user!.userId));
      if(!provider)return res.status(400).json({message:'Link your account to an employee to provide feedback'});
      const input=insertEmployeeFeedbackSchema.parse({...req.body,employeeId:Number(req.body.employeeId),providerId:provider.id,visibility:'private',feedbackType:req.body.feedbackType==='positive'?'praise':req.body.feedbackType,content:[req.body.subject,req.body.content].filter(Boolean).join('\n\n')});
      const [feedback]=await db.insert(employeeFeedback).values(input).returning();return res.status(201).json(feedback);
    }catch{return res.status(400).json({message:'Check the feedback fields'});}
  });
  // Get dashboard stats for performance management
  app.get('/api/performance/dashboard-stats', async (_req: Request, res: Response) => {
    try {
      const stats = await performanceService.getDashboardStats();
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

      const reviewData = req.body;
      const updatedReview = await performanceService.updateReview(reviewId, reviewData);
      return res.status(200).json(updatedReview);
    } catch (error) {
      console.error('[API] Error updating review:', error);
      return res.status(500).json({ error: 'Failed to update review' });
    }
  });
}