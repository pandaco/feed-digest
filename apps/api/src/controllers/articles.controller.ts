import {
  Controller, Get, Param, Inject, HttpException, HttpStatus,
} from '@nestjs/common';
import { StoragePort, TocEntry, extractToc } from '@feed-digest/core';

@Controller('api/articles')
export class ArticlesController {
  private readonly tocCache = new Map<string, TocEntry[]>();
  private readonly contentCache = new Map<string, { content: string; wordCount: number }>();

  constructor(@Inject('STORAGE') private readonly storage: StoragePort) {}

  @Get(':articleId/toc')
  async getToc(@Param('articleId') articleId: string) {
    if (this.tocCache.has(articleId)) {
      return { toc: this.tocCache.get(articleId) };
    }

    try {
      const [inbox, saved] = await Promise.all([
        this.storage.getFromInbox(),
        this.storage.getFromSaved(),
      ]);
      const article = [...inbox, ...saved].find(a => a.id === articleId);
      if (!article) {
        throw new HttpException('Article not found', HttpStatus.NOT_FOUND);
      }

      const response = await fetch(article.url);
      if (!response.ok) {
        return { toc: [] };
      }

      const html = await response.text();
      const toc = extractToc(html);
      this.tocCache.set(articleId, toc);
      return { toc };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('[API] Failed to extract TOC:', error);
      throw new HttpException('Failed to extract table of contents', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':articleId/content')
  async getContent(@Param('articleId') articleId: string) {
    if (this.contentCache.has(articleId)) {
      return this.contentCache.get(articleId);
    }

    try {
      const [inbox, saved] = await Promise.all([
        this.storage.getFromInbox(),
        this.storage.getFromSaved(),
      ]);
      const article = [...inbox, ...saved].find(a => a.id === articleId);
      if (!article) {
        throw new HttpException('Article not found', HttpStatus.NOT_FOUND);
      }

      const response = await fetch(article.url);
      if (!response.ok) {
        return { content: article.summary, wordCount: article.summary.split(/\s+/).length };
      }

      const html = await response.text();
      const wordCount = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
      const result = { content: html, wordCount };
      this.contentCache.set(articleId, result);
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('[API] Failed to fetch article content:', error);
      throw new HttpException('Failed to fetch article content', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
