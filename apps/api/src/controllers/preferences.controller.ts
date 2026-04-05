import {
  Controller, Get, Post, Delete, Param, Body, Inject, HttpException, HttpStatus,
} from '@nestjs/common';
import { TagPreferencePort } from '@feed-digest/core';
import { normalizeTag } from '@feed-digest/core';

@Controller('api/preferences')
export class PreferencesController {
  constructor(@Inject('TAG_PREFERENCE') private readonly tagPreference: TagPreferencePort) {}

  @Get(':chatId')
  async getPreferences(@Param('chatId') chatId: string) {
    const prefs = await this.tagPreference.get(chatId);
    if (!prefs) {
      return { chatId, tags: {}, scores: {}, tagOverrides: {}, runCount: 0 };
    }

    const threshold = parseFloat(process.env['TAG_PREFERENCE_THRESHOLD'] || '0.6');
    const minRuns = parseInt(process.env['TAG_PREFERENCE_MIN_RUNS'] || '3', 10);
    const overrides = prefs.tagOverrides ?? {};

    const scores: Record<string, { score: number; autoSelected: boolean }> = {};
    for (const [tag, stats] of Object.entries(prefs.tags)) {
      const score = stats.presentedCount > 0 ? stats.selectionCount / stats.presentedCount : 0;
      const override = overrides[tag];
      scores[tag] = {
        score,
        autoSelected:
          override === 'auto' ||
          (override !== 'filtered' && stats.presentedCount >= minRuns && score >= threshold),
      };
    }

    return { ...prefs, tagOverrides: overrides, runCount: prefs.runCount ?? 0, scores, threshold, minRuns };
  }

  @Post(':chatId/tags/:tag/override')
  async setTagOverride(
    @Param('chatId') chatId: string,
    @Param('tag') rawTag: string,
    @Body() body: { override: 'auto' | 'filtered' | null },
  ) {
    const { override } = body;
    if (override !== null && override !== 'auto' && override !== 'filtered') {
      throw new HttpException('override must be "auto", "filtered", or null', HttpStatus.BAD_REQUEST);
    }
    const tag = normalizeTag(rawTag);
    await this.tagPreference.setTagOverride(chatId, tag, override);
    return { tag, override };
  }

  @Delete(':chatId')
  async resetPreferences(@Param('chatId') chatId: string) {
    await this.tagPreference.reset(chatId);
    return { message: 'Preferences reset' };
  }
}
