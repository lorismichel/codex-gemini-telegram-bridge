import fs from 'node:fs';
import path from 'node:path';

function parseEnv(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(baseDir) {
  const envPath = path.join(baseDir, 'local.env');
  if (!fs.existsSync(envPath)) return;
  const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function loadProject(baseDir) {
  const projectPath = path.join(baseDir, 'project.json');
  const project = fs.existsSync(projectPath)
    ? JSON.parse(fs.readFileSync(projectPath, 'utf8'))
    : {};
  const geminiCmd = project.geminiCmd || 'gemini';

  return {
    repoPath: project.repoPath ? path.resolve(baseDir, project.repoPath) : path.resolve(baseDir, '..'),
    geminiCmd,
    geminiArgs: Array.isArray(project.geminiArgs) ? project.geminiArgs : ['--yolo'],
    allowedCommands: project.allowedCommands || {
      status: ['git', ['status', '--short']],
      diff: ['git', ['diff', '--stat']],
      log: ['git', ['log', '--oneline', '-5']],
      sessions: [geminiCmd, ['--list-sessions']]
    },
    allowAnyCommand: project.allowAnyCommand !== false,
    allowFirstChatRegistration: project.allowFirstChatRegistration !== false
  };
}
