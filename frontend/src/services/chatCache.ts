/**
 * Last-known data per account (documents, dashboard progress, chat list, projects) and recently opened chats,
 * so the app shows them instantly and refreshes in the background: the server can be slow to reach over a
 * phone connection or a tunnel, and nobody should stare at a spinner for data they saw a minute ago.
 *
 * Lists are kept per account in localStorage (cleared on logout); opened chats only in memory for this session.
 */
import { ConversationDetail, ConversationSummary, Project } from '../types';

const PREFIX = 'mindai.cache.';
const key = (userId: string, name: string) => `${PREFIX}${userId}.${name}`;
const MAX_OPENED = 30;

/** A cached value for this account, or null */
export const cached = <T,>(userId: string | null | undefined, name: string): T | null => {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(key(userId, name));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const saveCached = (userId: string | null | undefined, name: string, value: unknown) => {
  if (!userId) return;
  try {
    window.localStorage.setItem(key(userId, name), JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the app just loads from the server next time
  }
};

export const cachedChats = (userId: string) => cached<ConversationSummary[]>(userId, 'chats');
export const saveChats = (userId: string, chats: ConversationSummary[]) => saveCached(userId, 'chats', chats.slice(0, 200));

export const cachedProjects = (userId: string) => cached<Project[]>(userId, 'projects');
export const saveProjects = (userId: string, projects: Project[]) => saveCached(userId, 'projects', projects);

const opened = new Map<string, ConversationDetail>();

export const cachedChat = (id: string) => opened.get(id) ?? null;
export const saveChat = (chat: ConversationDetail) => {
  opened.delete(chat.id);
  opened.set(chat.id, chat);
  if (opened.size > MAX_OPENED) opened.delete(opened.keys().next().value as string);
};
export const forgetChat = (id: string) => { opened.delete(id); };

/** On logout: nothing of this account's data stays on the device */
export const clearChatCache = (userId: string) => {
  opened.clear();
  try {
    const mine = `${PREFIX}${userId}.`;
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && (k.startsWith(mine) || k === `mindai.chats.${userId}` || k === `mindai.projects.${userId}`)) window.localStorage.removeItem(k);
    }
  } catch {
    // Storage unavailable: nothing was stored
  }
};
