import TelegramBot from 'node-telegram-bot-api';
import { NotifierPort, RunSummary } from '@feed-digest/core';

export class TelegramNotifier implements NotifierPort {
  private bot: TelegramBot;
  private chatId: string;

  private readonly messages: Record<string, any> = {
    fr: {
      morning: 'Run du matin',
      evening: 'Run du soir',
      processed: 'Traités',
      remaining: 'articles restants pour le prochain run',
      duration: 'Durée',
      tagsIdentified: 'Tags identifiés',
      trendingTopics: 'Sujets tendance',
      sourceStatsTitle: 'Articles par source',
      error: (msg: string) => `⚠️ Erreur lors du run :\n${msg}`
    },
    en: {
      morning: 'Morning run',
      evening: 'Evening run',
      processed: 'Processed',
      remaining: 'articles remaining for the next run',
      duration: 'Duration',
      tagsIdentified: 'Tags identified',
      trendingTopics: 'Trending Topics',
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
    const isFr = summary.summaryLanguage === 'fr';
    const title = summary.runLabel === 'morning' ? i18n.morning : i18n.evening;

    let message = `<b>${title} — ${summary.date}</b>\n\n`;

    // Pipeline funnel
    if (summary.articlesCollected) {
      message += `📥 ${isFr ? 'Collectés' : 'Collected'} : ${summary.articlesCollected}\n`;
      if (summary.duplicatesRemoved) {
        message += `🔁 ${isFr ? 'Doublons retirés' : 'Duplicates removed'} : ${summary.duplicatesRemoved}\n`;
      }
      if (summary.noiseFiltered) {
        message += `🗑 ${isFr ? 'Bruit filtré' : 'Noise filtered'} : ${summary.noiseFiltered}\n`;
      }
    }
    message += `✅ ${i18n.processed} : ${summary.articlesProcessed} articles\n`;
    if (summary.failedCount) {
      message += `❌ ${isFr ? 'Échoués' : 'Failed'} : ${summary.failedCount}\n`;
    }
    message += `📋 ${summary.articlesRemaining} ${i18n.remaining}\n`;
    message += '\n';

    // Importance breakdown
    if (summary.importanceCounts) {
      const ic = summary.importanceCounts;
      message += `<b>${isFr ? 'Importance' : 'Importance'}</b>\n`;
      message += `🔴 High : ${ic.high}  🟡 Medium : ${ic.medium}  🟢 Low : ${ic.low}\n`;
    }

    // Relevance score
    if (summary.averageRelevanceScore !== undefined) {
      message += `📊 ${isFr ? 'Score moyen de pertinence' : 'Avg relevance score'} : ${summary.averageRelevanceScore}/10\n`;
    }
    message += '\n';

    // Top sources
    if (summary.topSources && summary.topSources.length > 0) {
      message += `<b>${isFr ? 'Top sources' : 'Top sources'}</b>\n`;
      for (const src of summary.topSources) {
        message += `  ${src.name} : ${src.count}\n`;
      }
      message += '\n';
    }

    // LLM usage
    if (summary.llmCalls) {
      const totalTokens = (summary.llmInputTokens ?? 0) + (summary.llmOutputTokens ?? 0);
      message += `<b>LLM (${summary.llmProvider})</b>\n`;
      message += `  ${isFr ? 'Appels' : 'Calls'} : ${summary.llmCalls}\n`;
      message += `  Tokens : ${this.formatNumber(totalTokens)} (in: ${this.formatNumber(summary.llmInputTokens ?? 0)} / out: ${this.formatNumber(summary.llmOutputTokens ?? 0)})\n`;
      message += '\n';
    }

    // Meta
    message += `${isFr ? 'Langue' : 'Lang'} : ${summary.summaryLanguage}\n`;
    if (summary.durationMs) {
      message += `⏱ ${i18n.duration} : ${this.formatDuration(summary.durationMs)}\n`;
    }
    message += `🏷 ${i18n.tagsIdentified} : ${Object.keys(summary.tagCounts).length}`;

    await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
  }

  async sendSourceStats(sourceCounts: Record<string, number>, language: string): Promise<void> {
    const i18n = this.messages[language] || this.messages['fr'];
    const sorted = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);

    let message = `<b>${i18n.sourceStatsTitle}</b>\n\n`;
    for (const [source, count] of sorted) {
      const line = `${source} : ${count}\n`;
      if (message.length + line.length > 4000) {
        message += '…\n';
        break;
      }
      message += line;
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

  async sendError(message: string, language: string): Promise<void> {
    const i18n = this.messages[language] || this.messages['fr'];
    await this.bot.sendMessage(this.chatId, i18n.error(message));
  }

  private formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toString();
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
