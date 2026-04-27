import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const project = JSON.parse(process.env.PROJECT_CONFIG_JSON || '{}');

if (!project.repoPath || !project.codexCmd) {
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
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: project.repoPath,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
      if (stdout.length > 8 * 1024 * 1024) child.kill('SIGTERM');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        const e = new Error('Command timed out: ' + cmd);
        e.stdout = stdout;
        e.stderr = stderr;
        reject(e);
        return;
      }
      if (code !== 0) {
        const tail = stderr ? ('\n' + stderr) : '';
        const e = new Error('Command failed: ' + cmd + ' ' + args.join(' ') + tail);
        e.stdout = stdout;
        e.stderr = stderr;
        e.code = code;
        reject(e);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseCodexJsonOutput(stdout) {
  const output = [];
  let sessionId = '';

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (parsed.type === 'thread.started' && parsed.thread_id) {
      sessionId = parsed.thread_id;
    }

    if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message') {
      output.push(parsed.item.text || '');
    }
  }

  return {
    sessionId,
    output: output.join('\n').trim() || '(empty)'
  };
}

async function runCodex(prompt, sessionId) {
  const codexArgs = project.codexArgs || [];
  const resumeSafeArgs = codexArgs.filter((arg) => arg !== '--search');
  const args = sessionId
    ? ['exec', 'resume', ...resumeSafeArgs, '--json', sessionId, '--', prompt]
    : ['exec', ...codexArgs, '--json', '--', prompt];
  const { stdout, stderr } = await runExecFile(project.codexCmd, args, 10 * 60 * 1000);
  const parsed = parseCodexJsonOutput(stdout);
  return {
    output: parsed.output || stderr.trim() || '(empty)',
    sessionId: parsed.sessionId || sessionId || ''
  };
}

async function runNamedCommand(commandName) {
  const entry = getAllowedCommand(commandName);
  if (entry) {
    const { stdout, stderr } = await runExecFile(entry.cmd, entry.args, 2 * 60 * 1000);
    return (stdout || stderr).trim() || '(empty)';
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
  return (stdout || stderr).trim() || '(empty)';
}

async function commitChanges(message) {
  const { stdout, stderr } = await runExecFile('git', ['commit', '-m', message], 2 * 60 * 1000);
  return (stdout || stderr).trim() || '(empty)';
}

async function pushChanges() {
  const { stdout, stderr } = await runExecFile('git', ['push'], 2 * 60 * 1000);
  return (stdout || stderr).trim() || '(empty)';
}

async function handleJob(message) {
  const { id, type, payload } = message;

  try {
    let output;
    let sessionId = '';
    if (type === 'ask') {
      const result = await runCodex(payload.prompt, payload.sessionId);
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
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

process.on('message', (message) => {
  handleJob(message);
});
