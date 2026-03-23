export interface TagStats {
  /** Number of times the tag was selected by the user */
  selectionCount: number;
  /** Number of times the tag was presented to the user */
  presentedCount: number;
  /** ISO 8601 date of the last selection */
  lastSelectedAt?: string;
}

export interface TagPreference {
  chatId: string;
  tags: Record<string, TagStats>;
}
