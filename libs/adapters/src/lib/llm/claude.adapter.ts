import Anthropic from '@anthropic-ai/sdk';
import { Article, LlmPort, LlmUsage, EnrichInput, EnrichOutput, normalizeTags } from '@feed-digest/core';
import { cleanHtml } from './clean-html';

export class ClaudeAdapter implements LlmPort {
  private client: Anthropic;
  private readonly model: string;
  private usage: LlmUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };

  constructor(apiKey: string, model = 'claude-3-5-sonnet-20240620') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  getUsage(): LlmUsage {
    return { ...this.usage };
  }

  private trackUsage(response: Anthropic.Message): void {
    this.usage.calls++;
    this.usage.inputTokens += response.usage?.input_tokens ?? 0;
    this.usage.outputTokens += response.usage?.output_tokens ?? 0;
  }

  async enrich(input: EnrichInput): Promise<EnrichOutput> {
    let systemPrompt = `You are an information and technology watch assistant.
      Respond ONLY with a valid JSON object, no markdown, no comments.
      Rules:
      - summary: written in ${input.language}, 3 to 5 sentences, factual and concise.
      - tags: up to ${input.maxTags} tags in ${input.language}, freely inferred from content (main topics, technologies, themes).
      - relevanceScore: an integer from 1 to 10 reflecting how relevant this article is to the user's interests (10 = extremely relevant, 1 = not relevant at all).`;

    if (input.userInterests) {
      systemPrompt += `\n      The user's interests are: ${input.userInterests}. Use this to assess relevance.`;
    } else {
      systemPrompt += `\n      No user interests provided — default relevanceScore to 5.`;
    }

    const userPrompt = `Here is the content of an article:
      <title>${input.title}</title>
      <content>${input.content}</content>

      Respond with the following JSON format:
      {
        "summary": "...",
        "tags": ["..."],
        "relevanceScore": 5
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
      this.trackUsage(response);

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
      this.trackUsage(response);

      return response.content[0].type === 'text' ? response.content[0].text : '';
    } catch (error) {
      console.error('[ClaudeAdapter] Failed to summarize run:', error);
      return `Global run summary (automated summary failed).`;
    }
  }

  async summarizeInbox(articles: Article[], language: string): Promise<string> {
    if (articles.length === 0) return '<p>No articles in inbox.</p>';

    const items = articles.map((a) =>
      `- [${a.feedSource}] "${a.title}" (${a.importance})`
    ).join('\n');

    const userPrompt = `Summarize these ${articles.length} articles concisely in ${language}. Output RAW HTML only (no markdown, no backticks, no code blocks).

Format:
<p>1-2 sentence overview.</p>
<h3>Themes</h3>
<ul><li><strong>Theme</strong> — one-line explanation</li></ul>
<h3>Standout</h3>
<ul><li><strong>Title</strong> — why it matters (one line)</li></ul>

Keep it short: max 5 themes, max 3 standout articles. No preamble, no conclusion.

Articles:
${items}`;

    try {
      const response = await this.withRetry(() =>
        this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: userPrompt }],
        })
      );

      this.trackUsage(response);
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return cleanHtml(text);
    } catch (error) {
      console.error('[ClaudeAdapter] Failed to summarize inbox:', error);
      return '<p>Summary generation failed.</p>';
    }
  }

  private parseResponse(content: string, title: string): EnrichOutput {
    try {
      // Handle potential markdown code blocks
      const jsonString = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(jsonString);
      const score = typeof parsed.relevanceScore === 'number' ? Math.max(1, Math.min(10, Math.round(parsed.relevanceScore))) : 5;
      return { ...parsed, tags: normalizeTags(parsed.tags ?? []), relevanceScore: score };
    } catch {
      console.warn('[ClaudeAdapter] JSON parsing failed for response:', content);
      return this.fallback(title);
    }
  }

  private fallback(title: string): EnrichOutput {
    return {
      summary: title,
      tags: [],
      relevanceScore: 5,
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
