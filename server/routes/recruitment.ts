import { randomUUID } from 'node:crypto';
import { Router } from "express";
import { db } from "../db";
import { 
  jobRequisitions, 
  candidates, 
  jobApplications, 
  interviews, 
  jobOffers,
  candidateSkills,
  candidateExperience,
  candidateEducation,
  employees,
  insertJobRequisitionSchema,
  insertCandidateSchema,
  insertJobApplicationSchema,
  insertInterviewSchema,
  insertJobOfferSchema,
  insertCandidateSkillSchema,
  insertCandidateExperienceSchema,
  insertCandidateEducationSchema
} from "@shared/schema";
import { eq, desc, count, sql, and, or, like } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// Job Requisitions Routes
router.get('/job-requisitions', async (req, res) => {
  try {
    const requisitions = await db
      .select({
        id: jobRequisitions.id,
        requisitionId: jobRequisitions.requisitionId,
        jobTitle: jobRequisitions.jobTitle,
        department: jobRequisitions.department,
        location: jobRequisitions.location,
        positionType: jobRequisitions.positionType,
        numberOfVacancies: jobRequisitions.numberOfVacancies,
        status: jobRequisitions.status,
        postingStartDate: jobRequisitions.postingStartDate,
        postingEndDate: jobRequisitions.postingEndDate,
        createdAt: jobRequisitions.createdAt
      })
      .from(jobRequisitions)
      .orderBy(desc(jobRequisitions.createdAt));
    
    res.json(requisitions);
  } catch (error) {
    console.error('Error fetching job requisitions:', error);
    res.status(500).json({ error: 'Failed to fetch job requisitions' });
  }
});

router.get('/job-requisitions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const requisition = await db
      .select()
      .from(jobRequisitions)
      .where(eq(jobRequisitions.id, id))
      .limit(1);
    
    if (requisition.length === 0) {
      return res.status(404).json({ error: 'Job requisition not found' });
    }
    
    res.json(requisition[0]);
  } catch (error) {
    console.error('Error fetching job requisition:', error);
    res.status(500).json({ error: 'Failed to fetch job requisition' });
  }
});

router.post('/job-requisitions', async (req, res) => {
  try {
    
    // Remove requestedBy from validation since we'll handle it separately
    const { requestedBy, ...bodyWithoutRequestedBy } = req.body;
    
    const validatedData = insertJobRequisitionSchema.parse(bodyWithoutRequestedBy);
    
    const requisitionId='JR-'+new Date().getFullYear()+'-'+randomUUID();
    const [requester]=await db.select({id:employees.id}).from(employees).where(eq(employees.userId,req.user!.userId));
    if(!requester)return res.status(400).json({error:'Link your account to an employee before creating a requisition'});
    const employeeId=requester.id;

    const result = await db
      .insert(jobRequisitions)
      .values({
        ...validatedData,
        requisitionId,
        requestedBy: employeeId
      })
      .returning();
    
    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Error creating job requisition:', error);
    if (error instanceof z.ZodError) {
      console.log('Validation errors:', JSON.stringify(error.errors, null, 2));
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create job requisition' });
  }
});

router.put('/job-requisitions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const validatedData = insertJobRequisitionSchema.partial().parse(req.body);
    
    const result = await db
      .update(jobRequisitions)
      .set({
        ...validatedData,
        updatedAt: new Date()
      })
      .where(eq(jobRequisitions.id, id))
      .returning();
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Job requisition not found' });
    }
    
    res.json(result[0]);
  } catch (error) {
    console.error('Error updating job requisition:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to update job requisition' });
  }
});

// Candidates Routes
router.get('/candidates', async (req, res) => {
  try {
    const candidatesList = await db
      .select({
        id: candidates.id,
        fullNameEn: candidates.fullNameEn,
        email: candidates.email,
        phone: candidates.phone,
        source: candidates.source,
        createdAt: candidates.createdAt
      })
      .from(candidates)
      .orderBy(desc(candidates.createdAt));
    
    res.json(candidatesList);
  } catch (error) {
    console.error('Error fetching candidates:', error);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

router.get('/candidates/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get candidate with skills, experience, and education
    const candidate = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, id))
      .limit(1);
    
    if (candidate.length === 0) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    
    const skills = await db
      .select()
      .from(candidateSkills)
      .where(eq(candidateSkills.candidateId, id));
    
    const experience = await db
      .select()
      .from(candidateExperience)
      .where(eq(candidateExperience.candidateId, id))
      .orderBy(desc(candidateExperience.startDate));
    
    const education = await db
      .select()
      .from(candidateEducation)
      .where(eq(candidateEducation.candidateId, id))
      .orderBy(desc(candidateEducation.startDate));
    
    res.json({
      ...candidate[0],
      skills,
      experience,
      education
    });
  } catch (error) {
    console.error('Error fetching candidate:', error);
    res.status(500).json({ error: 'Failed to fetch candidate' });
  }
});

router.post('/candidates', async (req, res) => {
  try {
    const { skills, experience, education, ...candidateData } = req.body;
    const validatedCandidateData = insertCandidateSchema.parse(candidateData);
    
    const result = await db.transaction(async (tx) => {
      // Insert candidate
      const candidateResult = await tx
        .insert(candidates)
        .values(validatedCandidateData)
        .returning();
      
      const candidateId = candidateResult[0].id;
      
      // Insert skills if provided
      if (skills && skills.length > 0) {
        const validatedSkills = skills.map((skill: any) => 
          insertCandidateSkillSchema.parse({ ...skill, candidateId })
        );
        await tx.insert(candidateSkills).values(validatedSkills);
      }
      
      // Insert experience if provided
      if (experience && experience.length > 0) {
        const validatedExperience = experience.map((exp: any) => 
          insertCandidateExperienceSchema.parse({ ...exp, candidateId })
        );
        await tx.insert(candidateExperience).values(validatedExperience);
      }
      
      // Insert education if provided
      if (education && education.length > 0) {
        const validatedEducation = education.map((edu: any) => 
          insertCandidateEducationSchema.parse({ ...edu, candidateId })
        );
        await tx.insert(candidateEducation).values(validatedEducation);
      }
      
      return candidateResult[0];
    });
    
    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating candidate:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create candidate' });
  }
});

// Job Applications Routes
router.get('/job-applications', async (req, res) => {
  try {
    const applications = await db
      .select({
        id: jobApplications.id,
        candidateId: jobApplications.candidateId,
        requisitionId: jobApplications.requisitionId,
        applicationDate: jobApplications.applicationDate,
        status: jobApplications.status,
        candidateName: candidates.fullNameEn,
        jobTitle: jobRequisitions.jobTitle
      })
      .from(jobApplications)
      .leftJoin(candidates, eq(jobApplications.candidateId, candidates.id))
      .leftJoin(jobRequisitions, eq(jobApplications.requisitionId, jobRequisitions.id))
      .orderBy(desc(jobApplications.applicationDate));
    
    res.json(applications);
  } catch (error) {
    console.error('Error fetching job applications:', error);
    res.status(500).json({ error: 'Failed to fetch job applications' });
  }
});

router.post('/job-applications', async (req, res) => {
  try {
    const validatedData = insertJobApplicationSchema.parse(req.body);
    
    const result = await db
      .insert(jobApplications)
      .values(validatedData)
      .returning();
    
    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Error creating job application:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create job application' });
  }
});

router.put('/job-applications/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, rejectionReason } = req.body;
    
    const result = await db
      .update(jobApplications)
      .set({
        status,
        rejectionReason: rejectionReason || null,
        updatedAt: new Date()
      })
      .where(eq(jobApplications.id, id))
      .returning();
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Job application not found' });
    }
    
    res.json(result[0]);
  } catch (error) {
    console.error('Error updating job application status:', error);
    res.status(500).json({ error: 'Failed to update job application status' });
  }
});

// Interviews Routes
router.get('/interviews', async (req, res) => {
  try {
    const interviewsList = await db
      .select({
        id: interviews.id,
        applicationId: interviews.applicationId,
        interviewerId: interviews.interviewerId,
        interviewDate: interviews.interviewDate,
        interviewRound: interviews.interviewRound,
        status: interviews.status,
        candidateName: candidates.fullNameEn,
        jobTitle: jobRequisitions.jobTitle,
        interviewerName: employees.firstName // Simplified for now
      })
      .from(interviews)
      .leftJoin(jobApplications, eq(interviews.applicationId, jobApplications.id))
      .leftJoin(candidates, eq(jobApplications.candidateId, candidates.id))
      .leftJoin(jobRequisitions, eq(jobApplications.requisitionId, jobRequisitions.id))
      .leftJoin(employees, eq(interviews.interviewerId, employees.id))
      .orderBy(desc(interviews.interviewDate));
    
    res.json(interviewsList);
  } catch (error) {
    console.error('Error fetching interviews:', error);
    res.status(500).json({ error: 'Failed to fetch interviews' });
  }
});

router.post('/interviews', async (req, res) => {
  try {
    const validatedData = insertInterviewSchema.parse(req.body);
    
    const result = await db
      .insert(interviews)
      .values(validatedData)
      .returning();
    
    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Error creating interview:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create interview' });
  }
});

router.put('/interviews/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const validatedData = insertInterviewSchema.partial().parse(req.body);
    
    const result = await db
      .update(interviews)
      .set({
        ...validatedData,
        updatedAt: new Date()
      })
      .where(eq(interviews.id, id))
      .returning();
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }
    
    res.json(result[0]);
  } catch (error) {
    console.error('Error updating interview:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to update interview' });
  }
});

// Job Offers Routes
router.get('/job-offers', async (req, res) => {
  try {
    const offers = await db
      .select({
        id: jobOffers.id,
        applicationId: jobOffers.applicationId,
        offerDate: jobOffers.offerDate,
        startDate: jobOffers.startDate,
        status: jobOffers.status,
        candidateName: candidates.fullNameEn,
        jobTitle: jobRequisitions.jobTitle
      })
      .from(jobOffers)
      .leftJoin(jobApplications, eq(jobOffers.applicationId, jobApplications.id))
      .leftJoin(candidates, eq(jobApplications.candidateId, candidates.id))
      .leftJoin(jobRequisitions, eq(jobApplications.requisitionId, jobRequisitions.id))
      .orderBy(desc(jobOffers.offerDate));
    
    res.json(offers);
  } catch (error) {
    console.error('Error fetching job offers:', error);
    res.status(500).json({ error: 'Failed to fetch job offers' });
  }
});

router.post('/job-offers', async (req, res) => {
  try {
    const validatedData = insertJobOfferSchema.parse(req.body);
    
    const result = await db
      .insert(jobOffers)
      .values(validatedData)
      .returning();
    
    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Error creating job offer:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create job offer' });
  }
});

router.put('/job-offers/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, acceptanceDate, declineReason } = req.body;
    
    const result = await db
      .update(jobOffers)
      .set({
        status,
        acceptanceDate: acceptanceDate || null,
        declineReason: declineReason || null,
        updatedAt: new Date()
      })
      .where(eq(jobOffers.id, id))
      .returning();
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Job offer not found' });
    }
    
    res.json(result[0]);
  } catch (error) {
    console.error('Error updating job offer status:', error);
    res.status(500).json({ error: 'Failed to update job offer status' });
  }
});

// Dashboard Stats
router.get('/dashboard-stats', async (req, res) => {
  try {
    const [
      activeRequisitions,
      totalCandidates,
      pendingApplications,
      scheduledInterviews,
      pendingOffers
    ] = await Promise.all([
      db.select({ count: count() }).from(jobRequisitions).where(eq(jobRequisitions.status, 'open')),
      db.select({ count: count() }).from(candidates),
      db.select({ count: count() }).from(jobApplications).where(eq(jobApplications.status, 'new')),
      db.select({ count: count() }).from(interviews).where(eq(interviews.status, 'scheduled')),
      db.select({ count: count() }).from(jobOffers).where(eq(jobOffers.status, 'pending'))
    ]);
    
    res.json({
      activeRequisitions: activeRequisitions[0]?.count || 0,
      totalCandidates: totalCandidates[0]?.count || 0,
      pendingApplications: pendingApplications[0]?.count || 0,
      scheduledInterviews: scheduledInterviews[0]?.count || 0,
      pendingOffers: pendingOffers[0]?.count || 0
    });
  } catch (error) {
    console.error('Error fetching recruitment dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;