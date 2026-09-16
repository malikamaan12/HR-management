import { Router, Request, Response } from 'express';
import * as reportingService from '../services/reporting';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Get dashboard stats
router.get('/dashboard/stats', async (req: Request, res: Response) => {
  try {
    const stats = await reportingService.getDashboardStats();
    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving dashboard stats', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get employee headcount report
router.get('/employee-headcount', async (req: Request, res: Response) => {
  try {
    const department = req.query.department as string | undefined;
    const site = req.query.site as string | undefined;
    const data = await reportingService.getEmployeeHeadcount(department, site);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating employee headcount report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get attendance summary report
router.get('/attendance-summary', async (req: Request, res: Response) => {
  try {
    const department = req.query.department as string | undefined;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const site = req.query.site as string | undefined;
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string, 10) : undefined;
    const data = await reportingService.getAttendanceSummary(department, startDate, endDate, site, teamId);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating attendance summary report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/saved-views', authenticate, async (req, res) => {
  try { return res.json(await reportingService.getReportDefinitions(req.user!.userId, false)); }
  catch (error) { return res.status(500).json({message: error instanceof Error ? error.message : 'Unable to load saved views'}); }
});
router.post('/saved-views', authenticate, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2 || name.length > 120) return res.status(400).json({message:'View name must be 2–120 characters'});
    return res.status(201).json(await reportingService.createReportDefinition({name,description:'Saved Reports & Analytics view',createdBy:req.user!.userId,isPublic:false,queryDefinition:req.body?.queryDefinition||{}}));
  } catch (error) { return res.status(400).json({message: error instanceof Error ? error.message : 'Unable to save view'}); }
});
router.delete('/saved-views/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const view = await reportingService.getReportDefinition(id);
    if (!view || view.createdBy !== req.user!.userId) return res.status(404).json({message:'Saved view not found'});
    await reportingService.deleteReportDefinition(id); return res.status(204).end();
  } catch (error) { return res.status(400).json({message: error instanceof Error ? error.message : 'Unable to delete view'}); }
});

// Get turnover rate report
router.get('/turnover-rate', async (req: Request, res: Response) => {
  try {
    const department = req.query.department as string | undefined;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const site = req.query.site as string | undefined;
    const data = await reportingService.getTurnoverRate(department, startDate, endDate, site);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating turnover rate report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get leave utilization report
router.get('/leave-utilization', async (req: Request, res: Response) => {
  try {
    const department = req.query.department as string | undefined;
    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const site = req.query.site as string | undefined;
    const data = await reportingService.getLeaveUtilization(department, year, site);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating leave utilization report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get event staff cost report
router.get('/event-staff-cost', async (req: Request, res: Response) => {
  try {
    const eventId = req.query.eventId ? parseInt(req.query.eventId as string) : undefined;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    
    const data = await reportingService.getEventStaffCost(eventId, startDate, endDate);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating event staff cost report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get compliance status report
router.get('/compliance-status', async (req: Request, res: Response) => {
  try {
    const data = await reportingService.getComplianceStatus();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating compliance status report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Export report to CSV
router.get('/export/:reportType', async (req: Request, res: Response) => {
  try {
    const reportType = req.params.reportType;
    const filters = req.query;
    
    const csvContent = await reportingService.exportReportToCsv(reportType, filters);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${reportType}-${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csvContent);
  } catch (error) {
    res.status(500).json({ message: 'Error exporting report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// CRUD operations for report definitions
router.get('/definitions', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
    const isPublic = req.query.isPublic === 'true';
    
    const definitions = await reportingService.getReportDefinitions(userId, isPublic);
    res.status(200).json(definitions);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving report definitions', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/definitions/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const definition = await reportingService.getReportDefinition(id);
    
    if (!definition) {
      return res.status(404).json({ message: 'Report definition not found' });
    }
    
    res.status(200).json(definition);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving report definition', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/definitions', authenticate, async (req: Request, res: Response) => {
  try {
    const definition = await reportingService.createReportDefinition(req.body);
    res.status(201).json(definition);
  } catch (error) {
    res.status(500).json({ message: 'Error creating report definition', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.put('/definitions/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const updatedDefinition = await reportingService.updateReportDefinition(id, req.body);
    
    if (!updatedDefinition) {
      return res.status(404).json({ message: 'Report definition not found' });
    }
    
    res.status(200).json(updatedDefinition);
  } catch (error) {
    res.status(500).json({ message: 'Error updating report definition', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.delete('/definitions/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const success = await reportingService.deleteReportDefinition(id);
    
    if (!success) {
      return res.status(404).json({ message: 'Report definition not found' });
    }
    
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: 'Error deleting report definition', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// CRUD operations for visualizations
router.get('/visualizations', async (req: Request, res: Response) => {
  try {
    const reportId = req.query.reportId ? parseInt(req.query.reportId as string) : undefined;
    const visualizations = await reportingService.getReportVisualizations(reportId);
    res.status(200).json(visualizations);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving visualizations', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/visualizations', authenticate, async (req: Request, res: Response) => {
  try {
    const visualization = await reportingService.createReportVisualization(req.body);
    res.status(201).json(visualization);
  } catch (error) {
    res.status(500).json({ message: 'Error creating visualization', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.put('/visualizations/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const updatedVisualization = await reportingService.updateReportVisualization(id, req.body);
    
    if (!updatedVisualization) {
      return res.status(404).json({ message: 'Visualization not found' });
    }
    
    res.status(200).json(updatedVisualization);
  } catch (error) {
    res.status(500).json({ message: 'Error updating visualization', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.delete('/visualizations/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const success = await reportingService.deleteReportVisualization(id);
    
    if (!success) {
      return res.status(404).json({ message: 'Visualization not found' });
    }
    
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: 'Error deleting visualization', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// CRUD operations for schedules
router.get('/schedules', async (req: Request, res: Response) => {
  try {
    const reportId = req.query.reportId ? parseInt(req.query.reportId as string) : undefined;
    const schedules = await reportingService.getReportSchedules(reportId);
    res.status(200).json(schedules);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving schedules', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/schedules', authenticate, async (req: Request, res: Response) => {
  try {
    const schedule = await reportingService.createReportSchedule(req.body);
    res.status(201).json(schedule);
  } catch (error) {
    res.status(500).json({ message: 'Error creating schedule', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.put('/schedules/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const updatedSchedule = await reportingService.updateReportSchedule(id, req.body);
    
    if (!updatedSchedule) {
      return res.status(404).json({ message: 'Schedule not found' });
    }
    
    res.status(200).json(updatedSchedule);
  } catch (error) {
    res.status(500).json({ message: 'Error updating schedule', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.delete('/schedules/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const success = await reportingService.deleteReportSchedule(id);
    
    if (!success) {
      return res.status(404).json({ message: 'Schedule not found' });
    }
    
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: 'Error deleting schedule', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get execution history
router.get('/execution-history', async (req: Request, res: Response) => {
  try {
    const reportId = req.query.reportId ? parseInt(req.query.reportId as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    
    const history = await reportingService.getReportExecutionHistory(reportId, limit);
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving execution history', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Execute report
router.post('/execute/:reportId', authenticate, async (req: Request, res: Response) => {
  try {
    const reportId = parseInt(req.params.reportId);
    const userId = req.user?.userId;
    const parameters = req.body.parameters || {};
    const format = req.body.format as string | undefined;
    
    // If no authenticated user (should not happen with authenticate middleware)
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    const result = await reportingService.executeReport(reportId, userId, parameters, format);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error executing report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
