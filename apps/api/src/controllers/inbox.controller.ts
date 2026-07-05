import {
  Controller, Get, Post, Delete, Param, Body, Inject, HttpException, HttpStatus, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { StoragePort, LlmPort, TagPreferencePort, Article, normalizeTag } from '@feed-digest/core';

function retagImportance(relevanceScore?: number): Article['importance'] {
  if (relevanceScore === undefined) return 'medium';
  if (relevanceScore >= 7) return 'high';
  if (relevanceScore <= 3) return 'low';
  return 'medium';
}

function tagsToSelections(articles: Article[], selected: boolean): Record<string, boolean> {
  const selections: Record<string, boolean> = {};
  for (const article of articles) {
    for (const tag of article.tags ?? []) {
      const key = normalizeTag(tag);
      if (key) selections[key] = selected;
    }
  }
  return selections;
}

@Controller('api/inbox')
export class InboxController {
  private readonly summaryLang: string;
  private readonly chatId: string;

  constructor(
    @Inject('STORAGE') private readonly storage: StoragePort,
    @Inject('LLM') private readonly llm: LlmPort,
    @Inject('TAG_PREFERENCE') private readonly tagPreference: TagPreferencePort,
  ) {
    this.summaryLang = process.env['SUMMARY_LANG'] || 'fr';
    this.chatId = process.env['TELEGRAM_CHAT_ID'] || '';
  }

  @Get()
  async getInbox() {
    try {
      const articles = await this.storage.getFromInbox();
      const now = new Date().toISOString();
      return articles.filter(a => !a.snoozedUntil || a.snoozedUntil <= now);
    } catch (error) {
      console.error('[API] Failed to fetch inbox:', error);
      throw new HttpException('Failed to fetch inbox', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('snoozed')
  async getSnoozed() {
    try {
      const articles = await this.storage.getFromInbox();
      const now = new Date().toISOString();
      return articles.filter(a => a.snoozedUntil && a.snoozedUntil > now);
    } catch (error) {
      console.error('[API] Failed to fetch snoozed articles:', error);
      throw new HttpException('Failed to fetch snoozed articles', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('summary')
  async generateSummary(@Body() body: { period?: string }) {
    try {
      let articles = await this.storage.getFromInbox();

      const period = body?.period;
      if (period) {
        const now = new Date();
        let since: Date;
        if (period === 'today') {
          since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period === 'week') {
          since = new Date(now);
          since.setDate(since.getDate() - 7);
        } else if (period === 'month') {
          since = new Date(now);
          since.setMonth(since.getMonth() - 1);
        } else {
          since = new Date(0);
        }
        articles = articles.filter(a => new Date(a.publishedAt) >= since);
      }

      const html = await this.llm.summarizeInbox(articles, this.summaryLang);
      return { html };
    } catch (error) {
      console.error('[API] Failed to generate inbox summary:', error);
      throw new HttpException('Failed to generate summary', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('synthesize')
  async synthesize(@Body() body: { articleIds: string[] }) {
    const { articleIds } = body;
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      throw new HttpException('articleIds must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    try {
      const idSet = new Set(articleIds);
      const allArticles = await this.storage.getFromInbox();
      const toSynthesize = allArticles.filter(a => idSet.has(a.id));
      if (toSynthesize.length === 0) {
        throw new HttpException('No matching articles found', HttpStatus.NOT_FOUND);
      }
      const html = await this.llm.summarizeInbox(toSynthesize, this.summaryLang);
      return { html };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('[API] Failed to synthesize articles:', error);
      throw new HttpException('Failed to synthesize articles', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('retag-untagged')
  async retagUntagged(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const articles = await this.storage.getUntaggedArticles();
      const total = articles.length;
      send({ type: 'start', total });

      if (total === 0) {
        send({ type: 'done', retagged: 0, errors: 0, total: 0 });
        res.end();
        return;
      }

      const summaryLang = process.env['SUMMARY_LANG'] || 'fr';
      const languageName = summaryLang === 'fr' ? 'French' : 'English';
      const maxTags = parseInt(process.env['MAX_TAGS'] || '3', 10);
      const userInterests = process.env['USER_INTERESTS'] || '';

      let retagged = 0;
      let errors = 0;

      for (const article of articles) {
        try {
          const content = article.summary || article.title;
          const enrichment = await this.llm.enrich({
            title: article.title,
            content,
            contentUnavailable: true,
            language: languageName,
            maxTags,
            userInterests: userInterests || undefined,
          });
          const importance = retagImportance(enrichment.relevanceScore);
          await this.storage.updateArticle({
            ...article,
            tags: enrichment.tags,
            relevanceScore: enrichment.relevanceScore,
            importance,
          });
          retagged++;
        } catch (err) {
          console.error(`[API] Failed to retag article ${article.id}:`, err);
          errors++;
        }
        send({ type: 'progress', retagged, errors, total });
      }

      send({ type: 'done', retagged, errors, total });
    } catch (err) {
      console.error('[API] Failed to retag untagged articles:', err);
      send({ type: 'error', message: 'Internal error' });
    }

    res.end();
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() body: { articleIds: string[]; skipTagFeedback?: boolean }) {
    const { articleIds, skipTagFeedback } = body;
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      throw new HttpException('articleIds must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    try {
      // Mass cleanups (skipTagFeedback) shouldn't count as a negative signal
      // on every deleted tag — and skipping also avoids the full inbox scan.
      if (this.chatId && !skipTagFeedback) {
        const idSet = new Set(articleIds);
        const allArticles = await this.storage.getFromInbox();
        const toDelete = allArticles.filter(a => idSet.has(a.id));
        await this.storage.deleteFromInbox(articleIds);
        if (toDelete.length > 0) {
          const selections = tagsToSelections(toDelete, false);
          if (Object.keys(selections).length > 0) {
            await this.tagPreference.record(this.chatId, selections).catch(() => undefined);
          }
        }
      } else {
        await this.storage.deleteFromInbox(articleIds);
      }
      return { deleted: articleIds.length };
    } catch (error) {
      console.error('[API] Failed to bulk delete:', error);
      throw new HttpException('Failed to bulk delete', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('save')
  async saveArticles(@Body() body: { articleIds: string[] }) {
    const { articleIds } = body;
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      throw new HttpException('articleIds must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    try {
      const idSet = new Set(articleIds);
      const allArticles = await this.storage.getFromInbox();
      const toSave = allArticles.filter(a => idSet.has(a.id));
      if (toSave.length === 0) {
        throw new HttpException('No matching articles found in inbox', HttpStatus.NOT_FOUND);
      }
      await this.storage.appendToSaved(toSave.map(a => ({ ...a, isSaved: true })));
      await this.storage.deleteFromInbox(toSave.map(a => a.id));
      if (this.chatId) {
        const selections = tagsToSelections(toSave, true);
        if (Object.keys(selections).length > 0) {
          await this.tagPreference.record(this.chatId, selections).catch(() => undefined);
        }
      }
      return { saved: toSave.length };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('[API] Failed to save articles:', error);
      throw new HttpException('Failed to save articles', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':articleId/snooze')
  async snooze(
    @Param('articleId') articleId: string,
    @Body() body: { snoozedUntil: string },
  ) {
    const { snoozedUntil } = body;
    if (!snoozedUntil || typeof snoozedUntil !== 'string') {
      throw new HttpException('snoozedUntil is required (ISO 8601 date)', HttpStatus.BAD_REQUEST);
    }
    try {
      const articles = await this.storage.getFromInbox();
      const article = articles.find(a => a.id === articleId);
      if (!article) {
        throw new HttpException('Article not found', HttpStatus.NOT_FOUND);
      }
      await this.storage.updateArticle({ ...article, snoozedUntil });
      return { message: 'Article snoozed' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('[API] Failed to snooze article:', error);
      throw new HttpException('Failed to snooze article', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':articleId/unsnooze')
  async unsnooze(@Param('articleId') articleId: string) {
    try {
      const articles = await this.storage.getFromInbox();
      const article = articles.find(a => a.id === articleId);
      if (!article) {
        throw new HttpException('Article not found', HttpStatus.NOT_FOUND);
      }
      await this.storage.updateArticle({ ...article, snoozedUntil: undefined });
      return { message: 'Article unsnoozed' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('[API] Failed to unsnooze article:', error);
      throw new HttpException('Failed to unsnooze article', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':articleId')
  async deleteInbox(@Param('articleId') articleId: string) {
    try {
      const allArticles = await this.storage.getFromInbox();
      const article = allArticles.find(a => a.id === articleId);
      await this.storage.deleteFromInbox([articleId]);
      if (this.chatId && article) {
        const selections = tagsToSelections([article], false);
        if (Object.keys(selections).length > 0) {
          await this.tagPreference.record(this.chatId, selections).catch(() => undefined);
        }
      }
      return { message: 'Article deleted' };
    } catch (error) {
      console.error('[API] Failed to delete article:', error);
      throw new HttpException('Failed to delete article', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
