/**
 * Last-known chat list, projects and recently opened chats, so AI Chat shows them instantly and refreshes
 * in the background (the server can be slow to reach over a phone connection or a tunnel).
 *
 * Lists are kept per account in localStorage; opened chats only in memory for this session.
 */
import { ConversationDetail, ConversationSummary, Project } from '../types';

const LIST_KEY = (userId: string) => `mindai.chats.${userId}`;
const PROJECTS_KEY = (userId: string) => `mindai.projects.${userId}`;
const MAX_OPENED = 30;

const read = <T,>(key: string): T | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the app just loads from the server next time
  }
};

export const cachedChats = (userId: string) => read<ConversationSummary[]>(LIST_KEY(userId));
export const saveChats = (userId: string, chats: ConversationSummary[]) => write(LIST_KEY(userId), chats.slice(0, 200));

export const cachedProjects = (userId: string) => read<Project[]>(PROJECTS_KEY(userId));
export const saveProjects = (userId: string, projects: Project[]) => write(PROJECTS_KEY(userId), projects);

const opened = new Map<string, ConversationDetail>();

export const cachedChat = (id: string) => opened.get(id) ?? null;
export const saveChat = (chat: ConversationDetail) => {
  opened.delete(chat.id);
  opened.set(chat.id, chat);
  if (opened.size > MAX_OPENED) opened.delete(opened.keys().next().value as string);
};
export const forgetChat = (id: string) => { opened.delete(id); };

/** On logout: nothing of this account's chats stays on the device */
export const clearChatCache = (userId: string) => {
  opened.clear();
  try {
    window.localStorage.removeItem(LIST_KEY(userId));
    window.localStorage.removeItem(PROJECTS_KEY(userId));
  } catch {
    // Storage unavailable: nothing was stored
  }
};
