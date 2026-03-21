import { GoogleGenerativeAI, GenerationConfig } from '@google/generative-ai';
import { Article, LlmPort, EnrichInput, EnrichOutput } from '@feed-digest/core';

export class GeminiAdapter implements LlmPort {
  private genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(apiKey: string, model: string = 'gemini-1.5-flash') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = model;
  }

  async enrich(input: EnrichInput): Promise<EnrichOutput> {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });

    const systemPrompt = `You are an information and technology watch assistant. 
      Respond ONLY with a valid JSON object, no markdown, no comments.
      Rules:
      - summary: written in ${input.language}, 3 to 5 sentences, factual and concise.
      - tags: up to ${input.maxTags} tags in ${input.language}, freely inferred from content (main topics, technologies, themes).
      - importance: high = critical or highly impactful / medium = interesting but not urgent / low = anecdotal.`;

    const userPrompt = `Here is the content of an article:
      <title>${input.title}</title>
      <content>${input.content}</content>
      
      Respond with the following JSON format:
      {
        "summary": "...",
        "tags": ["..."],
        "importance": "high|medium|low"
      }`;

    const generationConfig: GenerationConfig = {
      temperature: 0.1,
      topP: 0.95,
      topK: 64,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    };

    try {
      const result = await this.withRetry(() =>
        model.generateContent({
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig,
        })
      );

      const response = result.response;
      const content = response.text();
      return this.parseResponse(content, input.title);
    } catch (error) {
      console.error('[GeminiAdapter] Failed to enrich article:', error);
      return this.fallback(input.title);
    }
  }

  async summarizeRun(articles: Article[], language: string): Promise<string> {
    if (articles.length === 0) return '';
    
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    const titles = articles.map((a) => `- [${a.feedSource}] ${a.title}`).join('\n');
    
    const userPrompt = `As an information analyst, provide a global synthesis (3 to 4 sentences) of the main trending topics and key themes from today's collection of articles in ${language}.
      
      Articles:
      ${titles}`;

    try {
      const result = await this.withRetry(() =>
        model.generateContent(userPrompt)
      );
      
      return result.response.text();
    } catch (error) {
      console.error('[GeminiAdapter] Failed to summarize run:', error);
      return `Global run summary (automated summary failed).`;
    }
  }

  private parseResponse(content: string, title: string): EnrichOutput {
    try {
      // Even with responseMimeType, Gemini sometimes wraps with markdown
      const jsonString = content.replace(/```json|```/g, '').trim();
      return JSON.parse(jsonString);
    } catch (e) {
      console.warn('[GeminiAdapter] JSON parsing failed for response:', content);
      return this.fallback(title);
    }
  }

  private fallback(title: string): EnrichOutput {
    return {
      summary: title,
      tags: [],
      importance: 'low',
    };
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      // Simple error status extraction for common rate limits
      const isRetryable = error.message?.includes('429') || error.message?.includes('500');
      
      if (retries > 0 && isRetryable) {
        console.warn(`[GeminiAdapter] Retry attempt ${4 - retries} after ${delay}ms due to: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.withRetry(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  }
}
