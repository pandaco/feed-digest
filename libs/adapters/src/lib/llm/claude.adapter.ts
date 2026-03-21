import Anthropic from '@anthropic-ai/sdk';
import { Article, LlmPort, EnrichInput, EnrichOutput } from '@feed-digest/core';

export class ClaudeAdapter implements LlmPort {
  private client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20240620') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async enrich(input: EnrichInput): Promise<EnrichOutput> {
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

    try {
      const response = await this.withRetry(() =>
        this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        })
      );

      const content = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseResponse(content, input.title);
    } catch (error) {
      console.error('[ClaudeAdapter] Failed to enrich article:', error);
      return this.fallback(input.title);
    }
  }

  async summarizeRun(articles: Article[], language: string): Promise<string> {
    if (articles.length === 0) return '';
    
    const titles = articles.map((a) => `- [${a.feedSource}] ${a.title}`).join('\n');
    const userPrompt = `As an information analyst, provide a global synthesis (3 to 4 sentences) of the main trending topics and key themes from today's collection of articles in ${language}.
      
      Articles:
      ${titles}`;

    try {
      const response = await this.withRetry(() =>
        this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: userPrompt }],
        })
      );

      return response.content[0].type === 'text' ? response.content[0].text : '';
    } catch (error) {
      console.error('[ClaudeAdapter] Failed to summarize run:', error);
      return `Global run summary (automated summary failed).`;
    }
  }

  private parseResponse(content: string, title: string): EnrichOutput {
    try {
      // Handle potential markdown code blocks
      const jsonString = content.replace(/```json|```/g, '').trim();
      return JSON.parse(jsonString);
    } catch (e) {
      console.warn('[ClaudeAdapter] JSON parsing failed for response:', content);
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
      if (retries > 0 && (error.status === 429 || error.status >= 500)) {
        console.warn(`[ClaudeAdapter] Retry attempt ${4 - retries} after ${delay}ms due to: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.withRetry(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  }
}
