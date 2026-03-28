import fs from 'node:fs';
import path from 'node:path';

export function loadState(baseDir) {
  const statePath = path.join(baseDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    return { allowedChatId: '', chats: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return { allowedChatId: parsed.allowedChatId || '', chats: parsed.chats || {} };
}

export function saveState(baseDir, state) {
  fs.writeFileSync(path.join(baseDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

export function ensureChatState(state, chatId) {
  const key = String(chatId);
  if (!state.chats[key]) {
    state.chats[key] = { session: { current: '', recent: [] } };
  }
  const chatState = state.chats[key];
  if (!chatState.session) {
    chatState.session = { current: '', recent: [] };
  }
  if (!Array.isArray(chatState.session.recent)) {
    chatState.session.recent = [];
  }
  return chatState;
}

export function rememberSession(chatState, session) {
  if (!session?.id) return;
  chatState.session.current = session.id;
  chatState.session.recent = [
    session,
    ...chatState.session.recent.filter((entry) => entry.id !== session.id)
  ].slice(0, 20);
}
