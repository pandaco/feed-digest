import { google, sheets_v4 } from 'googleapis';
import { Article, StoragePort } from '@feed-digest/core';

export class GoogleSheetsAdapter implements StoragePort {
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;
  private tabsChecked = false;

  constructor(config: { spreadsheetId: string; serviceAccountJson: string }) {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(config.serviceAccountJson),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = config.spreadsheetId;
  }

  private async ensureTabsAndHeaders(): Promise<void> {
    if (this.tabsChecked) return;

    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    const existingTabs = spreadsheet.data.sheets?.map((s) => s.properties?.title) || [];
    const requiredTabs = ['Inbox', 'All', 'Saved'];
    
    // 1. Create missing tabs
    const missingTabs = requiredTabs.filter((tab) => !existingTabs.includes(tab));
    if (missingTabs.length > 0) {
      console.log(`[GoogleSheetsAdapter] Creating missing tabs: ${missingTabs.join(', ')}`);
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: missingTabs.map((tab) => ({
            addSheet: { properties: { title: tab } },
          })),
        },
      });
    }

    // 2. Check each required tab for headers (even if it already existed)
    for (const tab of requiredTabs) {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${tab}!A1:Z1`,
      });

      const hasContent = response.data.values && response.data.values.length > 0;
      if (!hasContent) {
        console.log(`[GoogleSheetsAdapter] Tab "${tab}" is empty. Writing headers...`);
        const headers = [
          'ID', 'Run At', 'Published At', 'Source', 'Title', 'URL', 'Tags',
          'Summary', 'Importance', 'Content Unavailable', 'LLM Provider', 'Summary Language',
          'Scraper Source'
        ];
        await this.writeHeaders(tab, headers);
      }
    }

    this.tabsChecked = true;
  }

  private async writeHeaders(tab: string, headers: string[]): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
    console.log(`[GoogleSheetsAdapter] Headers written to tab: ${tab}`);
  }

  async appendToInbox(articles: Article[]): Promise<void> {
    await this.ensureTabsAndHeaders();
    console.log(`[GoogleSheetsAdapter] Attempting to append ${articles.length} articles to Inbox...`);
    await this.appendArticles('Inbox', articles);
  }

  async appendToAll(articles: Article[]): Promise<void> {
    await this.ensureTabsAndHeaders();
    console.log(`[GoogleSheetsAdapter] Attempting to append ${articles.length} articles to All...`);
    await this.appendArticles('All', articles);
  }

  async appendToSaved(articles: Article[]): Promise<void> {
    await this.ensureTabsAndHeaders();
    console.log(`[GoogleSheetsAdapter] Attempting to append ${articles.length} articles to Saved...`);
    await this.appendArticles('Saved', articles);
  }

  async getFromSaved(): Promise<Article[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Saved!A:M',
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) return [];

    return rows.slice(1).map(row => ({ ...this.mapRowToArticle(row), isSaved: true }));
  }

  async deleteFromSaved(articleIds: string[]): Promise<void> {
    if (articleIds.length === 0) return;

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Saved!A:M',
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) return;

    const headers = rows[0];
    const dataRows = rows.slice(1);
    const filteredRows = dataRows.filter((row) => !articleIds.includes(row[0]));

    console.log(`[GoogleSheetsAdapter] Filtering Saved: ${dataRows.length} rows -> ${filteredRows.length} rows.`);

    await this.sheets.spreadsheets.values.clear({
      spreadsheetId: this.spreadsheetId,
      range: 'Saved!A:M',
    });

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: 'Saved!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers, ...filteredRows] },
    });
  }

  private async appendArticles(tab: string, articles: Article[]): Promise<void> {
    if (articles.length === 0) {
      console.log(`[GoogleSheetsAdapter] No articles to append to ${tab}.`);
      return;
    }

    // Determine formula separator based on language (French uses ;)
    const separator = articles[0]?.summaryLanguage === 'fr' ? ';' : ',';

    const values = articles.map((a) => [
      a.id,
      a.runAt,
      a.publishedAt,
      a.feedSource,
      `=HYPERLINK("${a.url}"${separator} "${a.title.replace(/"/g, '""')}")`,
      a.url,
      a.tags.join(', '),
      a.summary,
      a.importance,
      a.contentUnavailable ? 'TRUE' : 'FALSE',
      a.llmProvider,
      a.summaryLanguage,
      a.scraperSource || '',
    ]);

    const result = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${tab}!A2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });

    console.log(`[GoogleSheetsAdapter] Successfully appended ${result.data.updates?.updatedRows} rows to ${tab}.`);
  }

  async deleteFromInbox(articleIds: string[]): Promise<void> {
    if (articleIds.length === 0) return;

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Inbox!A:M',
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) return;

    const headers = rows[0];
    const dataRows = rows.slice(1);
    
    const filteredRows = dataRows.filter((row) => !articleIds.includes(row[0]));

    console.log(`[GoogleSheetsAdapter] Filtering Inbox: ${dataRows.length} rows -> ${filteredRows.length} rows.`);

    // Clear and rewrite
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId: this.spreadsheetId,
      range: 'Inbox!A:M',
    });

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: 'Inbox!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers, ...filteredRows] },
    });
  }

  async getFromInbox(): Promise<Article[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Inbox!A:M',
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) return [];

    const dataRows = rows.slice(1);
    
    return dataRows.map(row => this.mapRowToArticle(row));
  }

  async getUntaggedArticles(): Promise<Article[]> {
    const articles = await this.getFromInbox();
    return articles.filter(a => a.tags.length === 0);
  }

  async updateArticle(article: Article): Promise<void> {
    await this.ensureTabsAndHeaders();
    const tabs = ['Inbox', 'All', 'Saved'];
    
    for (const tab of tabs) {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${tab}!A:M`,
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) continue;

      const headers = rows[0];
      const dataRows = rows.slice(1);
      
      const articleIndex = dataRows.findIndex(row => row[0] === article.id);
      if (articleIndex === -1) continue;

      console.log(`[GoogleSheetsAdapter] Updating article ${article.id} in tab ${tab}...`);

      const separator = article.summaryLanguage === 'fr' ? ';' : ',';
      const updatedRow = [
        article.id,
        article.runAt,
        article.publishedAt,
        article.feedSource,
        `=HYPERLINK("${article.url}"${separator} "${article.title.replace(/"/g, '""')}")`,
        article.url,
        article.tags.join(', '),
        article.summary,
        article.importance,
        article.contentUnavailable ? 'TRUE' : 'FALSE',
        article.llmProvider,
        article.summaryLanguage,
        article.scraperSource || '',
      ];

      dataRows[articleIndex] = updatedRow;

      // Rewrite tab
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers, ...dataRows] },
      });
    }
  }

  private mapRowToArticle(row: any[]): Article {
    // Map back from columns: ID, Run At, Published At, Source, Title (formula), URL, Tags, Summary, Importance, Content Unavailable, LLM Provider, Summary Language
    const titleFormula = row[4] || '';
    let title = titleFormula;
    if (titleFormula.startsWith('=HYPERLINK')) {
      const match = titleFormula.match(/",\s*"(.*)"\)$/);
      if (match) title = match[1].replace(/""/g, '"');
    }

    return {
      id: row[0],
      runAt: row[1],
      publishedAt: row[2],
      feedSource: row[3],
      title: title,
      url: row[5],
      tags: (row[6] || '').split(', ').filter(Boolean),
      summary: row[7],
      importance: row[8] as any,
      contentUnavailable: row[9] === 'TRUE',
      llmProvider: row[10] as any,
      summaryLanguage: row[11],
      isSaved: false,
      scraperSource: row[12] || '',
    };
  }
}
