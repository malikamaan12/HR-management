import { insertPerformanceReviewSchema, insertReviewSectionSchema, insertReviewCriteriaSchema } from '@shared/schema';
import { z } from 'zod';
import { db } from '../db';
import { 
  performanceReviews,
  reviewSections,
  reviewCriteria,
  employeeGoals,
  goalMilestones,
  employeeFeedback,
  skillAssessments
} from '@shared/schema';
import { eq, and, desc, sql, asc } from 'drizzle-orm';

const criterionWriteSchema=insertReviewCriteriaSchema.omit({sectionId:true,criteriaOrder:true});
const sectionWriteSchema=insertReviewSectionSchema.omit({reviewId:true,sectionOrder:true}).extend({criteria:z.array(criterionWriteSchema).optional()});
const reviewWriteSchema=insertPerformanceReviewSchema.extend({sections:z.array(sectionWriteSchema).optional()});

export const performanceService = {
  /**
   * Get performance reviews for a specific employee
   */
  async getEmployeeReviews(employeeId: number) {
    try {
      const reviews = await db.query.performanceReviews.findMany({
        where: eq(performanceReviews.employeeId, employeeId),
        orderBy: [desc(performanceReviews.createdAt)],
      });
      
      return reviews;
    } catch (error) {
      console.error('Error fetching employee reviews:', error);
      throw new Error('Failed to fetch employee performance reviews');
    }
  },

  /**
   * Get details for a specific performance review
   */
  async getReviewDetails(reviewId: number) {
    try {
      // Get the review
      const review = await db.query.performanceReviews.findFirst({
        where: eq(performanceReviews.id, reviewId),
      });
      
      if (!review) {
        return null;
      }
      
      // Get the review sections
      const sections = await db.query.reviewSections.findMany({
        where: eq(reviewSections.reviewId, reviewId),
        orderBy: [asc(reviewSections.sectionOrder)],
      });
      
      // Get criteria for each section
      const sectionWithCriteria = await Promise.all(
        sections.map(async (section) => {
          const criteria = await db.query.reviewCriteria.findMany({
            where: eq(reviewCriteria.sectionId, section.id),
          });
          
          return {
            ...section,
            criteria,
          };
        })
      );
      
      // Get goals associated with this review
      const goals = await db.query.employeeGoals.findMany({
        where: eq(employeeGoals.relatedReviewId, reviewId),
      });
      
      // Get milestones for each goal
      const goalsWithMilestones = await Promise.all(
        goals.map(async (goal) => {
          const milestones = await db.query.goalMilestones.findMany({
            where: eq(goalMilestones.goalId, goal.id),
            orderBy: [asc(goalMilestones.dueDate)],
          });
          
          return {
            ...goal,
            milestones,
          };
        })
      );
      
      // Get feedback associated with this review
      const feedback = await db.query.employeeFeedback.findMany({
        where: eq(employeeFeedback.relatedReviewId, reviewId),
        orderBy: [desc(employeeFeedback.createdAt)],
      });
      
      return {
        review,
        sections: sectionWithCriteria,
        goals: goalsWithMilestones,
        feedback,
      };
    } catch (error) {
      console.error('Error fetching review details:', error);
      throw new Error('Failed to fetch review details');
    }
  },

  /**
   * Create a new performance review
   */
  async createReview(reviewData: unknown) {
    const input=reviewWriteSchema.parse(reviewData);
    return db.transaction(async tx=>{
      const {sections,...data}=input;
      const [review]=await tx.insert(performanceReviews).values(data).returning();
      for(const [index,section] of (sections || []).entries()){
        const {criteria,...sectionData}=section;
        const [saved]=await tx.insert(reviewSections).values({...sectionData,reviewId:review.id,sectionOrder:index+1}).returning();
        for(const [order,criterion] of (criteria || []).entries())await tx.insert(reviewCriteria).values({...criterion,sectionId:saved.id,criteriaOrder:order+1});
      }
      return review;
    });
  },
  async updateReview(reviewId:number,reviewData:unknown) {
    const input=reviewWriteSchema.partial().parse(reviewData);
    return db.transaction(async tx=>{
      const [existing]=await tx.select().from(performanceReviews).where(eq(performanceReviews.id,reviewId)).for('update');
      if(!existing)throw new Error('Review not found');
      const {sections,...data}=input;
      const [review]=await tx.update(performanceReviews).set({...data,updatedAt:new Date()}).where(eq(performanceReviews.id,reviewId)).returning();
      if(sections !== undefined){
        // Replace the nested collection atomically. IDs supplied by callers cannot target another review.
        const prior=await tx.select({id:reviewSections.id}).from(reviewSections).where(eq(reviewSections.reviewId,reviewId));
        for(const section of prior)await tx.delete(reviewCriteria).where(eq(reviewCriteria.sectionId,section.id));
        await tx.delete(reviewSections).where(eq(reviewSections.reviewId,reviewId));
        for(const [index,section] of sections.entries()){
          const {criteria,...sectionData}=section;
          const [saved]=await tx.insert(reviewSections).values({...sectionData,reviewId,sectionOrder:index+1}).returning();
          for(const [order,criterion] of (criteria || []).entries())await tx.insert(reviewCriteria).values({...criterion,sectionId:saved.id,criteriaOrder:order+1});
        }
      }
      return review;
    });
  },

  async getDashboardStats() {
    try {
      // Calculate average rating across all completed reviews
      const overallRatingResult = await db
        .select({
          avgRating: sql`AVG(CASE 
            WHEN overall_rating = 'exceptional' THEN 5.0
            WHEN overall_rating = 'exceeds' THEN 4.0
            WHEN overall_rating = 'meets' THEN 3.0
            WHEN overall_rating = 'needs_improvement' THEN 2.0
            WHEN overall_rating = 'unsatisfactory' THEN 1.0
            ELSE NULL
          END) * 100 / 5`.as('avgRating'),
          count: sql`COUNT(*)`.as('count') 
        })
        .from(performanceReviews)
        .where(eq(performanceReviews.status, 'completed'));
      
      const avgRating = Math.round(Number(overallRatingResult[0]?.avgRating) || 0);
      const totalReviews = Number(overallRatingResult[0]?.count) || 0;
      
      // Get count of upcoming reviews (draft but not started)
      const upcomingReviewsResult = await db
        .select({ count: sql`COUNT(*)` })
        .from(performanceReviews)
        .where(eq(performanceReviews.status, 'draft'));
      
      const upcomingReviews = Number(upcomingReviewsResult[0]?.count) || 0;
      
      // Calculate performance trends across different categories (from review sections)
      const ratings=await db.select({category:reviewSections.sectionName,rating:reviewSections.sectionRating}).from(reviewSections);
      const scores:Record<string,number>={exceptional:5,exceeds:4,meets:3,needs_improvement:2,unsatisfactory:1};
      const grouped=new Map<string,number[]>();
      for(const row of ratings){if(row.rating && scores[row.rating])grouped.set(row.category,[...(grouped.get(row.category)||[]),scores[row.rating]]);}
      const categoryTrendsData=Array.from(grouped,([category,values])=>({category,score:Math.round(values.reduce((a,b)=>a+b,0)/values.length*20),change:null}));
      
      return {
        avgRating,
        totalReviews,
        upcomingReviews,
        performanceTrends: categoryTrendsData
      };
    } catch (error) {
      console.error('Error fetching performance dashboard stats:', error);
      throw new Error('Failed to fetch performance dashboard statistics');
    }
  }
};