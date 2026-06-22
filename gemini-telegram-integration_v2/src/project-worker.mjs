import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const project = JSON.parse(process.env.PROJECT_CONFIG_JSON || '{}');

if (!project.repoPath || !project.geminiCmd) {
  throw new Error('PROJECT_CONFIG_JSON is missing required fields');
}

function getAllowedCommand(name) {
  const entry = project.allowedCommands?.[name];
  if (!entry || !Array.isArray(entry) || entry.length !== 2) {
    return null;
  }

  const [cmd, args] = entry;
  if (!cmd || !Array.isArray(args)) return null;
  return { cmd, args };
}

function parseCommandLine(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaping = false;

  for (const ch of String(input || '')) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (escaping || quote) {
    throw new Error('Invalid command line: unterminated escape or quote');
  }

  if (current) tokens.push(current);
  return tokens;
}

async function runExecFile(cmd, args, timeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: project.repoPath,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024
    });
    return {
      stdout: stdout || '',
      stderr: stderr || ''
    };
  } catch (error) {
    const stdout = error?.stdout || '';
    const stderr = error?.stderr || '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n${stdout}\n${stderr}`.trim());
  }
}

function cleanGeminiText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed === 'Loaded cached credentials.') return false;
      if (trimmed === 'YOLO mode is enabled. All tool calls will be automatically approved.') return false;
      return true;
    })
    .join('\n')
    .trim();
}

function summarizeGeminiError(error) {
  const text = cleanGeminiText(error instanceof Error ? error.message : String(error));

  if (/IneligibleTierError|UNSUPPORTED_CLIENT|no longer supported|Antigravity suite|Gemini Code Assist for individuals/i.test(text)) {
    return [
      'Gemini CLI Google OAuth is no longer supported for individual accounts.',
      'Set GEMINI_API_KEY in gemini-telegram-integration_v2/local.env, then restart com.gemini.agent.',
      'Validate locally with: gemini --list-sessions'
    ].join('\n');
  }

  if (/quota|QUOTA_EXHAUSTED|exhausted your capacity|TerminalQuotaError/i.test(text)) {
    const resetMatch = text.match(/reset after ([0-9a-z]+(?:[0-9a-z]+)?(?:\s*[0-9a-z]+)*)/i);
    const reset = resetMatch ? resetMatch[1].replace(/\s+/g, '') : '';
    return reset
      ? `Gemini API quota exhausted. Reset after ${reset}.`
      : 'Gemini API quota exhausted.';
  }

  if (/429/.test(text)) {
    return 'Gemini API rate limit or quota error.';
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.slice(0, 8).join('\n') || 'Gemini command failed.';
}

function parseGeminiSessions(stdout) {
  const sessions = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\.\s+(.+?)\s+\[[0-9a-f-]+\]$/i);
    if (!match) continue;
    const idMatch = line.match(/\[([0-9a-f-]+)\]$/i);
    if (!idMatch) continue;
    sessions.push({
      index: Number(match[1]),
      label: match[2].trim(),
      id: idMatch[1]
    });
  }
  return sessions;
}

async function listGeminiSessions() {
  const { stdout } = await runExecFile(project.geminiCmd, ['--list-sessions'], 60 * 1000);
  return parseGeminiSessions(stdout);
}

async function runGemini(prompt, sessionId) {
  const args = sessionId
    ? [...(project.geminiArgs || []), '--resume', sessionId, '--prompt', prompt]
    : [...(project.geminiArgs || []), '--prompt', prompt];
  const { stdout, stderr } = await runExecFile(project.geminiCmd, args, 10 * 60 * 1000);
  const sessions = await listGeminiSessions();
  return {
    output: cleanGeminiText(stdout || stderr) || '(empty)',
    sessionId: sessionId || sessions[0]?.id || ''
  };
}

async function runNamedCommand(commandName) {
  const entry = getAllowedCommand(commandName);
  if (entry) {
    const { stdout, stderr } = await runExecFile(entry.cmd, entry.args, 2 * 60 * 1000);
    return cleanGeminiText(stdout || stderr) || '(empty)';
  }

  if (!project.allowAnyCommand) {
    const allowed = Object.keys(project.allowedCommands || {}).sort().join(', ');
    throw new Error(`Unknown command "${commandName}". Allowed: ${allowed || '(none)'}`);
  }

  const argv = parseCommandLine(commandName);
  if (argv.length === 0) {
    throw new Error('Command is empty');
  }

  const { stdout, stderr } = await runExecFile(argv[0], argv.slice(1), 2 * 60 * 1000);
  return cleanGeminiText(stdout || stderr) || '(empty)';
}

async function commitChanges(message) {
  const { stdout, stderr } = await runExecFile('git', ['commit', '-m', message], 2 * 60 * 1000);
  return cleanGeminiText(stdout || stderr) || '(empty)';
}

async function pushChanges() {
  const { stdout, stderr } = await runExecFile('git', ['push'], 2 * 60 * 1000);
  return cleanGeminiText(stdout || stderr) || '(empty)';
}

async function handleJob(message) {
  const { id, type, payload } = message;

  try {
    let output;
    let sessionId = '';
    if (type === 'ask') {
      const result = await runGemini(payload.prompt, payload.sessionId);
      output = result.output;
      sessionId = result.sessionId;
    } else if (type === 'run') {
      output = await runNamedCommand(payload);
    } else if (type === 'commit') {
      output = await commitChanges(payload);
    } else if (type === 'push') {
      output = await pushChanges();
    } else if (type === 'ping') {
      output = 'worker:ok';
    } else {
      throw new Error(`Unsupported job type: ${type}`);
    }

    process.send?.({ id, ok: true, output, sessionId });
  } catch (error) {
    process.send?.({
      id,
      ok: false,
      error: summarizeGeminiError(error)
    });
  }
}

process.on('message', (message) => {
  handleJob(message);
});
