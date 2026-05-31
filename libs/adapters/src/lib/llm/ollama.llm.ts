import { Article, LlmPort, LlmUsage, EnrichInput, EnrichOutput, normalizeTags } from '@feed-digest/core';
import { cleanHtml } from './clean-html';

interface OllamaChatResponse {
  message: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done: boolean;
}

interface OllamaChatRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  format?: unknown;
  options?: Record<string, unknown>;
}

const ENRICH_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    relevanceScore: { type: 'integer', minimum: 1, maximum: 10 },
  },
  required: ['summary', 'tags', 'relevanceScore'],
} as const;

export class OllamaLlm implements LlmPort {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly numPredict: number;
  private usage: LlmUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };

  constructor(
    baseUrl = 'http://localhost:11434',
    model = 'llama3.1:8b',
    numPredict?: number,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    // Safety cap on generated tokens. With the JSON schema format the
    // model normally stops at the closing `}` (~100–150 tokens), so this
    // mostly catches the rare cases where it would otherwise ramble.
    this.numPredict = numPredict ?? 512;
  }

  getUsage(): LlmUsage {
    return { ...this.usage };
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
      <content>${input.content}</content>`;

    try {
      const response = await this.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        format: ENRICH_SCHEMA,
        options: { temperature: 0.1, num_predict: this.numPredict },
      });
      return this.parseResponse(response.message.content, input.title);
    } catch (error) {
      console.error('[OllamaLlm] Failed to enrich article:', error);
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
      const response = await this.chat({
        messages: [{ role: 'user', content: userPrompt }],
        options: { temperature: 0.3, num_predict: this.numPredict },
      });
      return response.message.content.trim();
    } catch (error) {
      console.error('[OllamaLlm] Failed to summarize run:', error);
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
      const response = await this.chat({
        messages: [{ role: 'user', content: userPrompt }],
        options: { temperature: 0.3, num_predict: this.numPredict },
      });
      return cleanHtml(response.message.content);
    } catch (error) {
      console.error('[OllamaLlm] Failed to summarize inbox:', error);
      return '<p>Summary generation failed.</p>';
    }
  }

  private async chat(body: OllamaChatRequest): Promise<OllamaChatResponse> {
    const url = `${this.baseUrl}/api/chat`;
    const data = await this.withRetry(async () => {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, stream: false, ...body }),
        });
      } catch (e: any) {
        throw Object.assign(new Error(`Ollama connection to ${this.baseUrl} failed: ${e.message}`), { retryable: true });
      }
      if (!res.ok) {
        const text = await res.text();
        throw Object.assign(new Error(`Ollama HTTP ${res.status}: ${text}`), { retryable: res.status >= 500 });
      }
      return (await res.json()) as OllamaChatResponse;
    });

    this.usage.calls++;
    this.usage.inputTokens += data.prompt_eval_count ?? 0;
    this.usage.outputTokens += data.eval_count ?? 0;
    return data;
  }

  private parseResponse(content: string, title: string): EnrichOutput {
    try {
      const jsonString = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(jsonString);
      const score = typeof parsed.relevanceScore === 'number' ? Math.max(1, Math.min(10, Math.round(parsed.relevanceScore))) : 5;
      return { ...parsed, tags: normalizeTags(parsed.tags ?? []), relevanceScore: score };
    } catch {
      console.warn('[OllamaLlm] JSON parsing failed for response:', content);
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

  private async withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 1000): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (retries > 0 && error?.retryable) {
        console.warn(`[OllamaLlm] Retry attempt ${3 - retries} after ${delay}ms due to: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.withRetry(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  }
}
