import Anthropic from '@anthropic-ai/sdk';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'integration-disabled',
});

// The newest model from Anthropic
const MODEL = 'claude-3-7-sonnet-20250219'; // the newest Anthropic model is "claude-3-7-sonnet-20250219" which was released February 24, 2025

class AnthropicService {
  /**
   * Process a text prompt with Claude
   * @param prompt The text prompt to process
   * @returns The model's response text or null if there was an error
   */
  async processTextPrompt(prompt: string): Promise<string | null> {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY is not set');
        return null;
      }

      const message = await anthropic.messages.create({
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
        model: MODEL,
      });

      if (!message.content || message.content.length === 0 || !('text' in message.content[0])) {
        return null;
      }

      return message.content[0].text;
    } catch (error) {
      console.error('Error processing text prompt with Anthropic:', error);
      return null;
    }
  }

  /**
   * Analyze the sentiment of a text
   * @param text The text to analyze
   * @returns An object containing the sentiment and confidence score
   */
  async analyzeSentiment(text: string): Promise<{ sentiment: string; confidence: number } | null> {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY is not set');
        return null;
      }

      const response = await anthropic.messages.create({
        model: MODEL,
        system: `You're a Customer Insights AI. Analyze this feedback and output in JSON format with keys: "sentiment" (positive/negative/neutral) and "confidence" (number, 0 through 1).`,
        max_tokens: 1024,
        messages: [
          { role: 'user', content: text }
        ],
      });

      if (!response.content || response.content.length === 0 || !('text' in response.content[0])) {
        return null;
      }

      try {
        const result = JSON.parse(response.content[0].text);
        return {
          sentiment: result.sentiment,
          confidence: Math.max(0, Math.min(1, result.confidence))
        };
      } catch (parseError) {
        console.error('Error parsing sentiment analysis response:', parseError);
        return null;
      }
    } catch (error) {
      console.error('Error analyzing sentiment with Anthropic:', error);
      return null;
    }
  }

  /**
   * Generate a professional communication response for a given situation
   * @param issue Description of the communication issue or situation
   * @returns A drafted response or null if there was an error
   */
  async generateCommunicationResponse(issue: string): Promise<string | null> {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY is not set');
        return null;
      }

      const response = await anthropic.messages.create({
        model: MODEL,
        system: `You're an HR Communication Assistant. Your task is to help draft professional and effective workplace communications. 
                For each situation described, provide a well-structured response that is:
                - Professional and appropriate for workplace communication
                - Clear and concise with proper structure
                - Empathetic but maintaining professional boundaries
                - Culturally sensitive and inclusive
                - Legally compliant with common HR practices in Qatar's corporate environment
                - Formatted properly for the appropriate medium (email, memo, announcement, etc.)`,
        max_tokens: 1024,
        messages: [
          { role: 'user', content: issue }
        ],
      });

      if (!response.content || response.content.length === 0 || !('text' in response.content[0])) {
        return null;
      }

      return response.content[0].text;
    } catch (error) {
      console.error('Error generating communication response with Anthropic:', error);
      return null;
    }
  }

  /**
   * Summarize a long text while preserving key points
   * @param text The text to summarize
   * @returns A concise summary or null if there was an error
   */
  async summarizeText(text: string): Promise<string | null> {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY is not set');
        return null;
      }

      const response = await anthropic.messages.create({
        model: MODEL,
        system: `You're a Text Summarization Assistant. Summarize the given text concisely while preserving the key points and main messages. 
                 The summary should be:
                 - Much shorter than the original text (about 20-25% of the original length)
                 - Well-structured with logical flow
                 - Include the most important information, key facts, and main conclusions
                 - Maintain the tone of the original text (formal, technical, casual, etc.)
                 - Be objective and avoid adding new information or opinions not in the original text`,
        max_tokens: 1024,
        messages: [
          { role: 'user', content: text }
        ],
      });

      if (!response.content || response.content.length === 0 || !('text' in response.content[0])) {
        return null;
      }

      return response.content[0].text;
    } catch (error) {
      console.error('Error summarizing text with Anthropic:', error);
      return null;
    }
  }
}

export default new AnthropicService();