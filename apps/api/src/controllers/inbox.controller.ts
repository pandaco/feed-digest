import {
  Controller, Get, Post, Delete, Param, Body, Inject, HttpException, HttpStatus,
} from '@nestjs/common';
import { StoragePort, LlmPort } from '@feed-digest/core';

@Controller('api/inbox')
export class InboxController {
  private readonly summaryLang: string;

  constructor(
    @Inject('STORAGE') private readonly storage: StoragePort,
    @Inject('LLM') private readonly llm: LlmPort,
  ) {
    this.summaryLang = process.env['SUMMARY_LANG'] || 'fr';
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
      const allArticles = await this.storage.getFromInbox();
      const toSynthesize = allArticles.filter(a => articleIds.includes(a.id));
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

  @Post('bulk-delete')
  async bulkDelete(@Body() body: { articleIds: string[] }) {
    const { articleIds } = body;
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      throw new HttpException('articleIds must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    try {
      await this.storage.deleteFromInbox(articleIds);
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
      const allArticles = await this.storage.getFromInbox();
      const toSave = allArticles.filter(a => articleIds.includes(a.id));
      if (toSave.length === 0) {
        throw new HttpException('No matching articles found in inbox', HttpStatus.NOT_FOUND);
      }
      await this.storage.appendToSaved(toSave.map(a => ({ ...a, isSaved: true })));
      await this.storage.deleteFromInbox(toSave.map(a => a.id));
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
      await this.storage.deleteFromInbox([articleId]);
      return { message: 'Article deleted' };
    } catch (error) {
      console.error('[API] Failed to delete article:', error);
      throw new HttpException('Failed to delete article', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
