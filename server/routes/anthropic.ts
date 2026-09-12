import { Router, Request, Response } from 'express';
import anthropicService from '../services/anthropic';

const router = Router();

// Middleware to check if Anthropic API key is set
const checkAnthropicApiKey = (req: Request, res: Response, next: Function) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({
      message: 'Anthropic API key is not configured. Please set the ANTHROPIC_API_KEY environment variable.'
    });
  }
  next();
};

/**
 * @route GET /api/anthropic/status
 * @desc Check if Anthropic API is available
 * @access Private
 */
router.get('/status', checkAnthropicApiKey, async (req: Request, res: Response) => {
  try {
    // Just a simple check to see if the API key is configured
    const testResult = await anthropicService.processTextPrompt('test');
    
    // Return a response based on the test result
    res.json({
      available: testResult !== null,
      model: 'claude-3-7-sonnet-20250219'
    });
  } catch (error) {
    console.error('Error checking Anthropic API status:', error);
    res.status(500).json({
      message: 'Failed to check Anthropic API status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/anthropic/process-prompt
 * @desc Process a text prompt with Claude
 * @access Private
 */
router.post('/process-prompt', checkAnthropicApiKey, async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ message: 'Prompt is required' });
    }
    
    const response = await anthropicService.processTextPrompt(prompt);
    
    if (response === null) {
      return res.status(500).json({ message: 'Failed to process prompt' });
    }
    
    res.json({ response });
  } catch (error) {
    console.error('Error processing prompt:', error);
    res.status(500).json({
      message: 'Server error processing prompt',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/anthropic/analyze-sentiment
 * @desc Analyze the sentiment of a text
 * @access Private
 */
router.post('/analyze-sentiment', checkAnthropicApiKey, async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ message: 'Text is required' });
    }
    
    const result = await anthropicService.analyzeSentiment(text);
    
    if (result === null) {
      return res.status(500).json({ message: 'Failed to analyze sentiment' });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
    res.status(500).json({
      message: 'Server error analyzing sentiment',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/anthropic/generate-response
 * @desc Generate a professional communication response
 * @access Private
 */
router.post('/generate-response', checkAnthropicApiKey, async (req: Request, res: Response) => {
  try {
    const { issue } = req.body;
    
    if (!issue) {
      return res.status(400).json({ message: 'Communication issue description is required' });
    }
    
    const response = await anthropicService.generateCommunicationResponse(issue);
    
    if (response === null) {
      return res.status(500).json({ message: 'Failed to generate communication response' });
    }
    
    res.json({ response });
  } catch (error) {
    console.error('Error generating communication response:', error);
    res.status(500).json({
      message: 'Server error generating communication response',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/anthropic/summarize
 * @desc Summarize a long text
 * @access Private
 */
router.post('/summarize', checkAnthropicApiKey, async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ message: 'Text is required' });
    }
    
    const summary = await anthropicService.summarizeText(text);
    
    if (summary === null) {
      return res.status(500).json({ message: 'Failed to summarize text' });
    }
    
    res.json({ summary });
  } catch (error) {
    console.error('Error summarizing text:', error);
    res.status(500).json({
      message: 'Server error summarizing text',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;