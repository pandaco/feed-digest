import { TagPreference } from './tag-preference';

export interface TagPreferencePort {
  /** Records selections from a run (all presented tags + which were checked) */
  record(chatId: string, selections: Record<string, boolean>): Promise<void>;
  /** Retrieves raw preferences for a chat */
  get(chatId: string): Promise<TagPreference | null>;
  /** Resets all preferences for a chat */
  reset(chatId: string): Promise<void>;
}
