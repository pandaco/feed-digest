import {
  Controller, Get, Delete, Post, Param, Body, Inject, HttpException, HttpStatus,
} from '@nestjs/common';
import { StoragePort } from '@feed-digest/core';

@Controller('api/saved')
export class SavedController {
  constructor(@Inject('STORAGE') private readonly storage: StoragePort) {}

  @Get()
  async getSaved() {
    try {
      return await this.storage.getFromSaved();
    } catch (error) {
      console.error('[API] Failed to fetch saved:', error);
      throw new HttpException('Failed to fetch saved articles', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':articleId')
  async deleteSaved(@Param('articleId') articleId: string) {
    try {
      await this.storage.deleteFromSaved([articleId]);
      return { message: 'Article removed from saved' };
    } catch (error) {
      console.error('[API] Failed to delete saved article:', error);
      throw new HttpException('Failed to delete saved article', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('bulk-delete')
  async bulkDeleteSaved(@Body() body: { articleIds: string[] }) {
    const { articleIds } = body;
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      throw new HttpException('articleIds must be a non-empty array', HttpStatus.BAD_REQUEST);
    }
    try {
      await this.storage.deleteFromSaved(articleIds);
      return { deleted: articleIds.length };
    } catch (error) {
      console.error('[API] Failed to bulk delete saved:', error);
      throw new HttpException('Failed to bulk delete saved articles', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
