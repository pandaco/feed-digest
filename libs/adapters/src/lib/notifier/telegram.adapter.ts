import TelegramBot from 'node-telegram-bot-api';
import { NotifierPort, RunSummary } from '@feed-digest/core';

export class TelegramAdapter implements NotifierPort {
  private bot: TelegramBot;
  private chatId: string;

  private readonly messages: Record<string, any> = {
    fr: {
      morning: 'Run du matin',
      evening: 'Run du soir',
      processed: 'Traités',
      remaining: 'articles restants pour le prochain run',
      llm: 'LLM',
      lang: 'Langue',
      duration: 'Durée',
      tagsIdentified: 'Tags identifiés',
      selectToKeep: 'Cochez les tags à CONSERVER dans votre Inbox :',
      validate: 'Valider la sélection',
      confirmation: (kept: number, removed: number) => `Sélection validée ! ${kept} articles conservés, ${removed} articles retirés de l'Inbox.`,
      tagArticles: (tag: string) => `Articles associés au tag <b>#${tag}</b> :`,
      trendingTopics: 'Sujets tendance',
      savedArticlesTitle: 'Articles sauvegardés',
      sourceStatsTitle: 'Articles par source',
      error: (msg: string) => `⚠️ Erreur lors du run :\n${msg}`
    },
    en: {
      morning: 'Morning run',
      evening: 'Evening run',
      processed: 'Processed',
      remaining: 'articles remaining for the next run',
      llm: 'LLM',
      lang: 'Lang',
      duration: 'Duration',
      tagsIdentified: 'Tags identified',
      selectToKeep: 'Check tags to KEEP in your Inbox:',
      validate: 'Validate selection',
      confirmation: (kept: number, removed: number) => `Selection validated! ${kept} articles kept, ${removed} articles removed from the Inbox.`,
      tagArticles: (tag: string) => `Articles for tag <b>#${tag}</b>:`,
      trendingTopics: 'Trending Topics',
      savedArticlesTitle: 'Saved articles',
      sourceStatsTitle: 'Articles by source',
      error: (msg: string) => `⚠️ Error during run:\n${msg}`
    }
  };

  constructor(config: { token: string; chatId: string }) {
    this.bot = new TelegramBot(config.token);
    this.chatId = config.chatId;
  }

  async sendRunSummary(summary: RunSummary): Promise<void> {
    const i18n = this.messages[summary.summaryLanguage] || this.messages['fr'];
    const title = summary.runLabel === 'morning' ? i18n.morning : i18n.evening;

    let message = `<b>${title} — ${summary.date}</b>\n\n`;
    message += `${i18n.processed} : ${summary.articlesProcessed} articles\n`;
    message += `${summary.articlesRemaining} ${i18n.remaining}\n`;
    message += `${i18n.llm} : ${summary.llmProvider} / ${i18n.lang} : ${summary.summaryLanguage}\n`;
    if (summary.durationMs) {
      message += `${i18n.duration} : ${this.formatDuration(summary.durationMs)}\n`;
    }
    message += `${i18n.tagsIdentified} : ${Object.keys(summary.tagCounts).length}`;

    await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
  }

  async sendSourceStats(sourceCounts: Record<string, number>, language: string): Promise<void> {
    const i18n = this.messages[language] || this.messages['fr'];
    const sorted = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);

    let message = `<b>${i18n.sourceStatsTitle}</b>\n\n`;
    for (const [source, count] of sorted) {
      message += `${source} : ${count}\n`;
    }

    await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
  }

  async sendSynthesis(synthesis: string, language: string): Promise<void> {
    const i18n = this.messages[language] || this.messages['fr'];
    const synth = synthesis.length > 3500 ? synthesis.substring(0, 3497) + '...' : synthesis;

    const message = `<b>${i18n.trendingTopics}</b>\n\n${synth}`;

    await this.bot.sendMessage(this.chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  async sendTagSelection(tagCounts: Record<string, number>, language: string): Promise<string> {
    const i18n = this.messages[language] || this.messages['fr'];
    const keyboard = this.buildKeyboard(tagCounts, i18n.validate);

    const sentMessage = await this.bot.sendMessage(this.chatId, i18n.selectToKeep, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });

    return sentMessage.message_id.toString();
  }

  async updateButtons(messageId: string, tags: Record<string, boolean>, tagOrder?: string[]): Promise<void> {
    const i18n = this.messages['fr'];

    const sortedKeys = tagOrder && tagOrder.length > 0
      ? tagOrder.filter(k => tags[k] !== undefined)
      : Object.keys(tags).sort((a, b) => a.localeCompare(b));

    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];

    keyboard.push([{ text: `🚀 ${i18n.validate}`, callback_data: 'validate' }]);

    for (let i = 0; i < sortedKeys.length && i < 96; i += 2) {
      const row: TelegramBot.InlineKeyboardButton[] = [];
      const tag1 = sortedKeys[i];
      row.push({ text: `${tags[tag1] ? '✅' : '⬜️'} ${tag1}`, callback_data: `toggle:${tag1}` });

      if (i + 1 < sortedKeys.length) {
        const tag2 = sortedKeys[i + 1];
        row.push({ text: `${tags[tag2] ? '✅' : '⬜️'} ${tag2}`, callback_data: `toggle:${tag2}` });
      }
      keyboard.push(row);
    }

    keyboard.push([{ text: `🚀 ${i18n.validate}`, callback_data: 'validate' }]);

    await this.bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, {
      chat_id: this.chatId,
      message_id: parseInt(messageId, 10)
    });
  }

  async sendConfirmation(keptNumber: number, removedNumber: number, language: string): Promise<void> {
    const i18n = this.messages[language] || this.messages['fr'];
    await this.bot.sendMessage(this.chatId, i18n.confirmation(keptNumber, removedNumber));
  }

  async sendTagArticles(tagName: string, articles: { title: string; url: string }[], language: string): Promise<void> {
    const i18n = this.messages[language] || this.messages['fr'];
    let message = `${i18n.tagArticles(tagName)}\n\n`;

    for (const article of articles) {
      message += `• <a href="${article.url}">${article.title}</a>\n`;
    }

    await this.bot.sendMessage(this.chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  async sendSavedArticles(articles: { title: string; url: string }[], language: string): Promise<void> {
    if (articles.length === 0) return;
    const i18n = this.messages[language] || this.messages['fr'];
    let message = `<b>${i18n.savedArticlesTitle} (${articles.length})</b>\n\n`;

    for (const article of articles) {
      message += `• <a href="${article.url}">${article.title}</a>\n`;
    }

    await this.bot.sendMessage(this.chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  async sendError(message: string, language: string): Promise<void> {
    const i18n = this.messages[language] || this.messages['fr'];
    await this.bot.sendMessage(this.chatId, i18n.error(message));
  }

  private buildKeyboard(tagCounts: Record<string, number>, validateLabel: string): TelegramBot.InlineKeyboardButton[][] {
    const sortedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);

    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];

    keyboard.push([{ text: `🚀 ${validateLabel}`, callback_data: 'validate' }]);

    for (let i = 0; i < sortedTags.length && i < 96; i += 2) {
      const row: TelegramBot.InlineKeyboardButton[] = [];
      row.push({ text: `⬜️ ${sortedTags[i]}`, callback_data: `toggle:${sortedTags[i]}` });

      if (i + 1 < sortedTags.length) {
        row.push({ text: `⬜️ ${sortedTags[i + 1]}`, callback_data: `toggle:${sortedTags[i + 1]}` });
      }
      keyboard.push(row);
    }

    keyboard.push([{ text: `🚀 ${validateLabel}`, callback_data: 'validate' }]);

    return keyboard;
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }
}
