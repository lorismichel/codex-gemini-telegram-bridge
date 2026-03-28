import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';

import { loadEnv, loadProject } from './config.mjs';
import { logEvent } from './logger.mjs';
import { splitMessage } from './shared.mjs';
import { ensureChatState, loadState, rememberSession, saveState } from './state.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

loadEnv(baseDir);

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const state = loadState(baseDir);
let allowedChatId = String(process.env.TELEGRAM_ALLOWED_CHAT_ID || state.allowedChatId || '');

if (!botToken) throw new Error('Missing TELEGRAM_BOT_TOKEN');

const project = loadProject(baseDir);
const worker = fork(path.join(baseDir, 'src', 'project-worker.mjs'), {
  env: { ...process.env, PROJECT_CONFIG_JSON: JSON.stringify(project) },
  stdio: ['inherit', 'inherit', 'inherit', 'ipc']
});
const logMessageText = process.env.LOG_MESSAGE_TEXT === 'true';

let nextUpdateOffset = 0;
let nextJobId = 1;
const pending = new Map();

worker.on('message', (message) => {
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
});

function submitJob(type, payload) {
  const id = nextJobId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.send({ id, type, payload });
  });
}

function persistState() {
  state.allowedChatId = allowedChatId;
  saveState(baseDir, state);
}

function logIntegrationEvent(event) {
  logEvent(baseDir, { integration: 'gemini-telegram-integration_v2', ...event });
}

function redactText(text, fieldName) {
  const value = String(text || '');
  return logMessageText
    ? { [fieldName]: value }
    : { [`${fieldName}Length`]: value.length };
}

function summarizeError(error) {
  const cause = error?.cause;
  const code = cause?.code || error?.code || '';
  const message = error instanceof Error ? error.message : String(error);

  if (code) {
    return `${message} (${code})`;
  }

  return message;
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Telegram API ${method} failed with ${response.status}`);
  const json = await response.json();
  if (!json.ok) throw new Error(`Telegram API ${method} error: ${json.description}`);
  return json.result;
}

async function sendText(chatId, text) {
  const repoPath = project.repoPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalized = String(text || '')
    .replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(new RegExp(`${repoPath}/`, 'g'), '')
    .replace(/#L(\d+)(?:C(\d+))?/g, (_, line, column) => column ? `:${line}:${column}` : `:${line}`)
    .replace(/\/Users\/[^/\s]+\/Documents\/GitHub\/[^/\s]+\//g, '');

  for (const chunk of splitMessage(normalized)) {
    await telegram('sendMessage', { chat_id: chatId, text: chunk });
  }
}

async function withTyping(chatId, task) {
  await telegram('sendChatAction', { chat_id: chatId, action: 'typing' });
  const timer = setInterval(() => {
    telegram('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  }, 4000);
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

async function installTelegramCommands() {
  await telegram('setMyCommands', {
    commands: [
      { command: 'help', description: 'show help' },
      { command: 'where', description: 'show current session' },
      { command: 'ask', description: 'send prompt to Gemini' },
      { command: 'status', description: 'git status --short' },
      { command: 'diff', description: 'git diff --stat' },
      { command: 'log', description: 'git log --oneline -5' },
      { command: 'sessions', description: 'show tracked sessions' },
      { command: 'resume', description: 'resume tracked session' },
      { command: 'reset_session', description: 'clear current session' },
      { command: 'commit', description: 'git commit -m <message>' },
      { command: 'push', description: 'git push' },
      { command: 'shutdown', description: 'stop manager' }
    ]
  });
}

function isAllowedMessage(message) {
  const chatId = String(message?.chat?.id || '');
  if (!chatId) return false;
  if (!allowedChatId) {
    if (!project.allowFirstChatRegistration) {
      logIntegrationEvent({ type: 'message_rejected', chatId, reason: 'missing_allowed_chat_id' });
      return false;
    }
    allowedChatId = chatId;
    persistState();
    logIntegrationEvent({ type: 'chat_registered', chatId });
    return true;
  }
  if (chatId !== allowedChatId) {
    logIntegrationEvent({ type: 'message_rejected', chatId, reason: 'chat_not_allowed' });
  }
  return chatId === allowedChatId;
}

function getChatState(chatId) {
  return ensureChatState(state, chatId);
}

function helpText(chatState) {
  return [
    'gemini-telegram-integration_v2',
    `current session: ${chatState.session.current || '(none)'}`,
    'commands:',
    'plain text message -> acts like /ask',
    '/where',
    '/ask <prompt>',
    '/status',
    '/diff',
    '/log',
    '/sessions',
    '/resume <latest|index|session-id>',
    '/reset-session',
    '/commit <message>',
    '/push',
    '/run <command-name>',
    '/shutdown'
  ].join('\n');
}

function formatSessions(chatState) {
  const lines = ['gemini-telegram-integration_v2', `current session: ${chatState.session.current || '(none)'}`];
  if (chatState.session.recent.length === 0) {
    lines.push('recent sessions: (none)');
  } else {
    lines.push('recent sessions:');
    chatState.session.recent.forEach((session, index) => {
      lines.push(`${index + 1}. ${session.id}${session.updatedAt ? ` (${session.updatedAt})` : ''}`);
    });
  }
  return lines.join('\n');
}

function resolveSessionReference(chatState, rawReference) {
  const reference = String(rawReference || '').trim();
  if (!reference || reference === 'latest') {
    return chatState.session.current || chatState.session.recent[0]?.id || '';
  }
  if (/^\d+$/.test(reference)) {
    return chatState.session.recent[Number(reference) - 1]?.id || '';
  }
  return reference;
}

async function runAsk(chatId, chatState, prompt) {
  const startedAt = Date.now();
  logIntegrationEvent({
    type: 'command_started',
    chatId: String(chatId),
    command: 'ask',
    sessionId: chatState.session.current || '',
    ...redactText(prompt, 'prompt')
  });
  const result = await withTyping(chatId, () => submitJob('ask', { prompt, sessionId: chatState.session.current || '' }));
  if (result.ok && result.sessionId) {
    rememberSession(chatState, { id: result.sessionId, updatedAt: new Date().toISOString() });
    persistState();
  }
  logIntegrationEvent({
    type: result.ok ? 'command_finished' : 'command_failed',
    chatId: String(chatId),
    command: 'ask',
    sessionId: result.sessionId || chatState.session.current || '',
    durationMs: Date.now() - startedAt,
    ok: result.ok,
    error: result.ok ? '' : result.error,
    ...redactText(prompt, 'prompt')
  });
  await sendText(chatId, result.ok ? result.output : `error\n${result.error}`);
}

async function runNamed(chatId, commandName) {
  const startedAt = Date.now();
  logIntegrationEvent({ type: 'command_started', chatId: String(chatId), command: 'run', raw: commandName });
  const result = await withTyping(chatId, () => submitJob('run', commandName));
  logIntegrationEvent({
    type: result.ok ? 'command_finished' : 'command_failed',
    chatId: String(chatId),
    command: 'run',
    raw: commandName,
    durationMs: Date.now() - startedAt,
    ok: result.ok,
    error: result.ok ? '' : result.error
  });
  await sendText(chatId, result.ok ? result.output : `error\n${result.error}`);
}

async function handleCommand(message) {
  if (!isAllowedMessage(message)) return;
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();
  const chatState = getChatState(chatId);
  logIntegrationEvent({ type: 'message_received', chatId: String(chatId), ...redactText(text, 'text') });

  if (text === '/start' || text === '/help') return sendText(chatId, helpText(chatState));
  if (text === '/where') return sendText(chatId, `gemini-telegram-integration_v2\ncurrent session: ${chatState.session.current || '(none)'}`);
  if (text === '/status') return runNamed(chatId, 'status');
  if (text === '/diff') return runNamed(chatId, 'diff');
  if (text === '/log') return runNamed(chatId, 'log');
  if (text === '/sessions') return sendText(chatId, formatSessions(chatState));

  if (text === '/reset-session' || text === '/reset_session') {
    const previous = chatState.session.current || '(none)';
    chatState.session.current = '';
    persistState();
    return sendText(chatId, `cleared current session: ${previous}`);
  }

  if (text.startsWith('/resume ')) {
    const sessionId = resolveSessionReference(chatState, text.slice('/resume '.length));
    if (!sessionId) return sendText(chatId, 'no tracked session found');
    chatState.session.current = sessionId;
    persistState();
    return sendText(chatId, `resumed session: ${sessionId}`);
  }

  if (text.startsWith('/ask ')) return runAsk(chatId, chatState, text.slice('/ask '.length).trim());
  if (text.startsWith('/run ')) return runNamed(chatId, text.slice('/run '.length).trim());

  if (text.startsWith('/commit ')) {
    const payload = text.slice('/commit '.length).trim();
    const result = await withTyping(chatId, () => submitJob('commit', payload));
    logIntegrationEvent({ type: result.ok ? 'command_finished' : 'command_failed', chatId: String(chatId), command: 'commit', raw: payload, ok: result.ok, error: result.ok ? '' : result.error });
    return sendText(chatId, result.ok ? result.output : `error\n${result.error}`);
  }

  if (text === '/push') {
    const result = await withTyping(chatId, () => submitJob('push', ''));
    logIntegrationEvent({ type: result.ok ? 'command_finished' : 'command_failed', chatId: String(chatId), command: 'push', ok: result.ok, error: result.ok ? '' : result.error });
    return sendText(chatId, result.ok ? result.output : `error\n${result.error}`);
  }

  if (text === '/shutdown') {
    logIntegrationEvent({ type: 'shutdown_requested', chatId: String(chatId) });
    await sendText(chatId, 'shutting down manager');
    persistState();
    setTimeout(() => {
      worker.kill();
      process.exit(0);
    }, 200);
    return;
  }

  if (!text.startsWith('/')) return runAsk(chatId, chatState, text);
  return sendText(chatId, helpText(chatState));
}

async function poll() {
  const result = await telegram('getUpdates', {
    timeout: 30,
    offset: nextUpdateOffset,
    allowed_updates: ['message']
  });
  for (const update of result) {
    nextUpdateOffset = update.update_id + 1;
    if (update.message?.text) await handleCommand(update.message);
  }
}

async function retryForever(label, fn, delayMs = 3000) {
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const summary = summarizeError(error);
      console.error(`${label} failed: ${summary}. Retrying in ${Math.round(delayMs / 1000)}s.`);
      logIntegrationEvent({
        type: 'network_error',
        label,
        error: summary,
        retryDelayMs: delayMs
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  const ping = await submitJob('ping', '');
  if (!ping.ok) throw new Error(ping.error);
  await retryForever('setMyCommands', () => installTelegramCommands());
  persistState();
  logIntegrationEvent({ type: 'manager_started' });
  while (true) {
    await retryForever('poll', () => poll());
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
