import { Router, Request, Response } from 'express';
import * as analyticsService from '../services/analytics';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Get predictive turnover analysis
router.get('/predictive-turnover', authenticate, authorize(['admin', 'hr']), async (req: Request, res: Response) => {
  try {
    const department = req.query.department as string | undefined;
    const data = await analyticsService.getPredictiveTurnover(department);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating predictive turnover analysis', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get skill gap analysis
router.get('/skill-gap', authenticate, authorize(['admin', 'hr']), async (req: Request, res: Response) => {
  try {
    const department = req.query.department as string | undefined;
    const data = await analyticsService.getSkillGapAnalysis(department);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating skill gap analysis', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get performance trends
router.get('/performance-trends', authenticate, authorize(['admin', 'hr']), async (req: Request, res: Response) => {
  try {
    const timeSpan = req.query.timeSpan ? parseInt(req.query.timeSpan as string) : 12; // Default to 12 months
    const department = req.query.department as string | undefined;
    
    const data = await analyticsService.getPerformanceTrends(timeSpan, department);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error generating performance trends analysis', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Custom analytics report execution
router.post('/custom-report', authenticate, async (req: Request, res: Response) => {
  try {
    const reportParams = req.body;
    
    if (!reportParams || !reportParams.dataSource) {
      return res.status(400).json({ message: 'Invalid report parameters. dataSource is required.' });
    }
    
    const result = await analyticsService.executeCustomReport(reportParams);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error executing custom analytics report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Export custom report in various formats
router.post('/export-report', authenticate, async (req: Request, res: Response) => {
  try {
    const { reportParams, format } = req.body;
    
    if (!reportParams || !reportParams.dataSource || !format) {
      return res.status(400).json({ message: 'Invalid export parameters. Both reportParams with dataSource and format are required.' });
    }
    
    const exportData = await analyticsService.exportCustomReport(reportParams, format);
    
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=analytics-export-${new Date().toISOString().split('T')[0]}.csv`);
      res.status(200).send(exportData.data);
    } else {
      // For other formats, just return metadata about the export
      res.status(200).json(exportData);
    }
  } catch (error) {
    res.status(500).json({ message: 'Error exporting analytics report', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;