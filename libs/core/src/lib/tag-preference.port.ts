import { TagOverride, TagPreference } from './tag-preference';

export interface TagPreferencePort {
  /** Records selections from a run (all presented tags + which were checked) */
  record(chatId: string, selections: Record<string, boolean>): Promise<void>;
  /** Retrieves raw preferences for a chat */
  get(chatId: string): Promise<TagPreference | null>;
  /** Resets all preferences for a chat */
  reset(chatId: string): Promise<void>;
  /** Sets an override for a tag (auto, filtered) or removes it (null = default) */
  setTagOverride(chatId: string, tag: string, override: TagOverride | null): Promise<void>;
}
