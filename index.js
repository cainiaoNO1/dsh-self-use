import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const inject = ['webServer', 'sessions'];

const PREFIX = '/api/dsh-self-use';
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SESSION_LOG_FILE = 'session.v4.jsonl.zstd';
const SCAN_TIMEOUT_MS = 8000;
const SCAN_CONCURRENCY = 4;
const DELETE_BATCH_LIMIT = 200;
const DELETE_BODY_LIMIT = 64 * 1024;
const DISPOSE_WAIT_MS = 3000;
const DETACH_WAIT_MS = 200;
const TIMEOUT_CODE = 'scan-timeout';
const AUTO_BODY_LIMIT = 8 * 1024;
const AUTO_CLEANUP_DIR = 'dsh-self-use';
const AUTO_CLEANUP_FILE = 'auto-cleanup.json';
const AUTO_CLEANUP_INTERVAL_MS = 60000;
const AUTO_CLEANUP_MIN_MINUTES = 1;
const AUTO_CLEANUP_MAX_MINUTES = 10080;
const AUTO_CLEANUP_DEFAULT_MINUTES = 60;
const AUTO_INTERVAL_ENV = 'DSH_SELF_USE_AUTOCLEAN_INTERVAL_MS';
const AUTO_SKILLS_FILE = 'auto-skills.json';
const AUTO_SKILLS_BODY_LIMIT = 16 * 1024;
const AUTO_SKILLS_LIMIT = 50;
const SKILL_NAME_RE = /^[\w-]+$/;

function readVersion() {
  try {
    const raw = fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(raw);
    if (pkg && typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch (_) {}
  return '0.0.0';
}

const VERSION = readVersion();

function blocksToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const part of content) {
    if (!part) continue;
    if (typeof part === 'string') {
      parts.push(part);
      continue;
    }
    if (typeof part.text === 'string') parts.push(part.text);
  }
  return parts.join('\n');
}

function messageText(data) {
  if (!data || typeof data !== 'object') return '';
  const message = data.message && typeof data.message === 'object' ? data.message : null;
  const fromMessage = message ? blocksToText(message.content) : '';
  if (fromMessage) return fromMessage;
  return blocksToText(data.content);
}

/**
 * Whether one log event is a real human prompt. Every injected context
 * (time-context, skill-catalog, runtime-context, user-approval, ...) also
 * arrives as a user/message event; only source.kind === 'user' is the human.
 * A log written before the source field existed carries none and is kept.
 */
export function isRealUserMessage(event) {
  if (!event || typeof event !== 'object' || event.type !== 'user/message') return false;
  const data = event.data && typeof event.data === 'object' ? event.data : null;
  const source = data && data.source && typeof data.source === 'object' ? data.source : null;
  return !source || source.kind === 'user';
}

export function extractPrompts(events) {
  const list = Array.isArray(events) ? events : [];
  const prompts = [];
  let turnCount = 0;

  for (let index = 0; index < list.length; index++) {
    const event = list[index];
    if (!event || typeof event !== 'object') continue;
    const data = event.data && typeof event.data === 'object' ? event.data : {};

    if (event.type === 'turn/start') {
      turnCount = typeof data.turn === 'number' ? data.turn : turnCount + 1;
      continue;
    }
    if (!isRealUserMessage(event)) continue;

    const text = messageText(data);
    if (!text.trim()) continue;

    prompts.push({
      seq: typeof event.seq === 'number' ? event.seq : index,
      turn: typeof data.turn === 'number' ? data.turn : turnCount || 1,
      text,
      time: typeof event.time === 'number' ? event.time : Date.now()
    });
  }

  prompts.sort((a, b) => a.seq - b.seq);
  return prompts;
}

/**
 * Emptiness inputs for one event log: zero real user prompts and zero
 * turn/start. Both must hold; either alone is not proof of emptiness.
 */
export function summarizeSessionEvents(events) {
  const list = Array.isArray(events) ? events : [];
  let hasUserPrompt = false;
  let hasTurnStart = false;

  for (const event of list) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'turn/start') hasTurnStart = true;
    else if (isRealUserMessage(event)) hasUserPrompt = true;
  }

  return { hasUserPrompt, hasTurnStart, eventCount: list.length };
}

/**
 * Decompress every zstd frame in a buffer. A session log is a concatenation of
 * independently compressed frames, and zstdDecompressSync stops after the first
 * one; frames are located by the 4-byte magic and joined in order.
 */
export function decodeZstdFrames(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  const frames = [];
  let offset = 0;

  while (offset + 4 <= source.length) {
    if (source[offset] !== 0x28 || source[offset + 1] !== 0xb5 || source[offset + 2] !== 0x2f || source[offset + 3] !== 0xfd) {
      const next = source.indexOf(ZSTD_MAGIC, offset + 1);
      if (next < 0) break;
      offset = next;
      continue;
    }
    try {
      frames.push(zlib.zstdDecompressSync(source.subarray(offset)));
    } catch (_) {
      // An undecodable frame is dropped here; the log parser rejects the
      // truncated result rather than guessing at its contents.
    }
    const next = source.indexOf(ZSTD_MAGIC, offset + 4);
    if (next < 0) break;
    offset = next;
  }

  return Buffer.concat(frames);
}

function isSafeSessionId(sessionId) {
  if (typeof sessionId !== 'string') return false;
  const id = sessionId.trim();
  if (!id || id.length > 256) return false;
  if (id === '.' || id === '..') return false;
  if (id.includes('/') || id.includes('\\') || id.includes('\0')) return false;
  if (path.isAbsolute(id)) return false;
  return true;
}

/**
 * Absolute-path guard: return the resolved target only when it is strictly
 * inside rootDir, exactly two segments below it, with no traversal segment.
 */
export function guardInsideRoot(rootDir, targetPath) {
  if (typeof rootDir !== 'string' || !rootDir) return null;
  if (typeof targetPath !== 'string' || !targetPath) return null;
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!target.startsWith(prefix)) return null;
  const segments = target.slice(prefix.length).split(path.sep);
  if (segments.length !== 2) return null;
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return target;
}

function candidateDirNames(sessionId) {
  const names = new Set();
  const bare = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId;
  names.add(sessionId);
  if (bare) names.add('session-' + bare);
  return [...names];
}

/**
 * Locate the on-disk directory of one session: the session-uuid (or bare uuid,
 * as subagent sessions use) directory under the sessions root, grouped by
 * workspace. The returned path is guaranteed to sit exactly two levels below
 * that root; anything else returns null so callers never delete outside it.
 */
export function resolveSessionDir(homeDir, sessionId) {
  if (!isSafeSessionId(sessionId)) return null;
  const id = sessionId.trim();
  const root = path.resolve(String(homeDir || os.homedir()), '.dsh', 'sessions');

  let workspaces;
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return null;
  }

  const names = candidateDirNames(id);
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const workspaceDir = path.join(root, workspace.name);
    for (const name of names) {
      const candidate = path.join(workspaceDir, name);
      let stat;
      try {
        stat = fs.statSync(candidate);
      } catch (_) {
        continue;
      }
      if (!stat.isDirectory()) continue;
      const guarded = guardInsideRoot(root, candidate);
      if (guarded) return guarded;
    }
  }

  return null;
}

function parseSessionLog(text, sessionId) {
  const events = [];
  let header = null;

  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch (_) {
      throw new Error('corrupt-session-log');
    }
    if (!value || typeof value !== 'object') throw new Error('corrupt-session-log');
    if (!header && value.type === 'session') {
      header = value;
      continue;
    }
    events.push(value);
  }

  if (!header) throw new Error('missing-session-header');
  if (sessionId && header.id !== sessionId) throw new Error('session-header-mismatch');
  return { header, events };
}

function readDiskSession(homeDir, sessionId) {
  const dir = resolveSessionDir(homeDir, sessionId);
  if (!dir) return null;
  const buffer = fs.readFileSync(path.join(dir, SESSION_LOG_FILE));
  const parsed = parseSessionLog(decodeZstdFrames(buffer).toString('utf8'), sessionId);
  return {
    sessionId,
    cwd: typeof parsed.header.cwd === 'string' ? parsed.header.cwd : null,
    createdAt: Number.isFinite(parsed.header.createdAt) ? parsed.header.createdAt : null,
    events: parsed.events,
    // The header line is a persisted log record too; counting it keeps the
    // zstd and sessionQuery sources reporting the same number for one session.
    recordCount: parsed.events.length + 1,
    source: 'zstd'
  };
}

function listDiskCandidates(homeDir) {
  const root = path.resolve(String(homeDir || os.homedir()), '.dsh', 'sessions');
  const candidates = [];
  let workspaces;
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return candidates;
  }

  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const workspaceDir = path.join(root, workspace.name);
    let entries;
    try {
      entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(workspaceDir, entry.name, SESSION_LOG_FILE);
      let stat;
      try {
        stat = fs.statSync(file);
      } catch (_) {
        continue;
      }
      if (!stat.isFile()) continue;
      candidates.push({ sessionId: entry.name });
    }
  }

  return candidates;
}

function getService(ctx, name) {
  if (!ctx) return null;
  try {
    const direct = ctx[name];
    if (direct) return direct;
  } catch (_) {}
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get(name) : null;
    if (viaGet) return viaGet;
  } catch (_) {}
  return null;
}

function errorMessage(error) {
  try {
    if (error && typeof error.message === 'string' && error.message) return error.message;
    return String(error);
  } catch (_) {
    return 'unknown error';
  }
}

function timeoutError() {
  const error = new Error('session scan exceeded its time budget');
  error.code = TIMEOUT_CODE;
  return error;
}

function isTimeout(error) {
  return Boolean(error && error.code === TIMEOUT_CODE);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDeadline(promise, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(timeoutError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError()), remaining);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function readSessionRecord(ctx, query, homeDir, sessionId, deadline) {
  if (query && typeof query.readSession === 'function') {
    try {
      const snapshot = await withDeadline(query.readSession(sessionId), deadline);
      const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : null;
      if (events) {
        const header = snapshot.session && typeof snapshot.session === 'object'
          ? snapshot.session
          : snapshot.header && typeof snapshot.header === 'object' ? snapshot.header : {};
        return {
          sessionId,
          cwd: typeof header.cwd === 'string' ? header.cwd : null,
          createdAt: Number.isFinite(header.createdAt) ? header.createdAt : null,
          events,
          recordCount: events.length + 1,
          source: 'sessionQuery'
        };
      }
    } catch (error) {
      if (isTimeout(error)) throw error;
      // A session the query engine cannot read falls through to the log file.
    }
  }

  const fromDisk = readDiskSession(homeDir, sessionId);
  if (fromDisk) return fromDisk;
  throw new Error('session-unreadable');
}

function isLiveActive(ctx, sessionId) {
  const agents = getService(ctx, 'agents');
  if (!agents || typeof agents.get !== 'function') return false;
  let agent;
  try {
    agent = agents.get(sessionId);
  } catch (_) {
    return false;
  }
  if (!agent) return false;
  try {
    return agent.status === 'running';
  } catch (_) {
    return false;
  }
}

/**
 * Scan every session the host can read and return those with zero real user
 * prompts and zero turn/start. One unreadable session never aborts the scan;
 * the whole scan is bounded by timeoutMs and concurrency.
 */
export async function collectEmptySessions(ctx, options = {}) {
  const homeDir = typeof options.homeDir === 'string' && options.homeDir ? options.homeDir : os.homedir();
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : SCAN_TIMEOUT_MS;
  const concurrency = Number.isFinite(options.concurrency) && options.concurrency > 0
    ? Math.max(1, Math.floor(options.concurrency))
    : SCAN_CONCURRENCY;
  const deadline = Date.now() + timeoutMs;
  const query = getService(ctx, 'sessionQuery');
  const skipped = [];
  const sessions = [];
  let partial = false;

  let candidates = [];
  if (query && typeof query.listSessions === 'function') {
    try {
      const records = await withDeadline(query.listSessions(), deadline);
      if (Array.isArray(records)) {
        candidates = records
          .map((record) => (record && record.header && typeof record.header === 'object' ? record.header : null))
          .filter(Boolean)
          .map((header) => ({ sessionId: header.id }));
      }
    } catch (error) {
      if (isTimeout(error)) partial = true;
      candidates = [];
    }
  }
  if (!candidates.length) candidates = listDiskCandidates(homeDir);

  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      if (Date.now() >= deadline) {
        partial = true;
        return;
      }
      const candidate = candidates[cursor++];
      const sessionId = candidate && typeof candidate.sessionId === 'string' ? candidate.sessionId : '';
      if (!sessionId) continue;

      let record;
      try {
        record = await readSessionRecord(ctx, query, homeDir, sessionId, deadline);
      } catch (error) {
        if (isTimeout(error)) partial = true;
        skipped.push({ sessionId, reason: errorMessage(error) });
        continue;
      }

      const summary = summarizeSessionEvents(record.events);
      if (summary.hasUserPrompt || summary.hasTurnStart) continue;
      if (isLiveActive(ctx, sessionId)) {
        skipped.push({ sessionId, reason: 'live-active' });
        continue;
      }

      sessions.push({
        sessionId,
        cwd: record.cwd,
        createdAt: record.createdAt,
        eventCount: record.recordCount,
        source: record.source
      });
    }
  };

  const workerCount = Math.min(concurrency, Math.max(1, candidates.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return { ok: true, sessions, skipped, partial };
}

async function disposeLiveSession(ctx, sessionId, warnings) {
  try {
    const agents = getService(ctx, 'agents');
    const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : null;
    if (agent) {
      try {
        if (typeof agent.cancel === 'function') agent.cancel({ kind: 'disposed' });
      } catch (error) {
        warnings.push('agent-cancel: ' + errorMessage(error));
      }
      try {
        const scope = agent.scope;
        if (scope && typeof scope.dispose === 'function') {
          await Promise.race([Promise.resolve().then(() => scope.dispose()), sleep(DISPOSE_WAIT_MS)]);
        }
      } catch (error) {
        warnings.push('agent-dispose: ' + errorMessage(error));
      }
      try {
        agents.store?.delete?.(sessionId);
      } catch (error) {
        warnings.push('agent-store-delete: ' + errorMessage(error));
      }
    }
  } catch (error) {
    warnings.push('agent: ' + errorMessage(error));
  }
}

async function detachLiveSession(ctx, sessionId, warnings) {
  let detached = false;
  try {
    const sessions = getService(ctx, 'sessions');
    const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null;
    if (session) {
      try {
        if (typeof sessions.flush === 'function') await sessions.flush(session);
      } catch (error) {
        warnings.push('session-flush: ' + errorMessage(error));
      }
      try {
        const entry = sessions.store?.get?.(sessionId);
        if (entry && typeof entry.detach === 'function') {
          entry.detach();
          detached = true;
          await sleep(DETACH_WAIT_MS);
        }
      } catch (error) {
        warnings.push('session-detach: ' + errorMessage(error));
      }
    }
  } catch (error) {
    warnings.push('session: ' + errorMessage(error));
  }
  return detached;
}

async function detachFromWorkspaces(ctx, sessionId, warnings) {
  try {
    const registry = getService(ctx, 'workspaceRegistry');
    if (!registry || typeof registry.list !== 'function') return;
    for (const entity of registry.list()) {
      if (!entity || typeof entity.detachSession !== 'function') continue;
      try {
        await entity.detachSession(sessionId);
      } catch (error) {
        warnings.push('workspace-detach: ' + errorMessage(error));
      }
    }
  } catch (error) {
    warnings.push('workspace-registry: ' + errorMessage(error));
  }
}

async function unarchiveSession(ctx, sessionId, warnings) {
  try {
    const registry = getService(ctx, 'workspaceRegistry');
    if (registry && typeof registry.unarchiveSession === 'function') {
      await registry.unarchiveSession(sessionId);
    }
  } catch (error) {
    warnings.push('unarchive: ' + errorMessage(error));
  }
}

async function removeSessionArtifacts(homeDir, sessionId, warnings) {
  const dir = resolveSessionDir(homeDir, sessionId);
  if (!dir) return { removed: false, reason: 'path-guard' };

  const sessionsRoot = path.resolve(String(homeDir || os.homedir()), '.dsh', 'sessions');
  const guarded = guardInsideRoot(sessionsRoot, dir);
  if (!guarded) return { removed: false, reason: 'path-guard' };

  try {
    await fsp.rm(guarded, { recursive: true, force: true });
  } catch (error) {
    return { removed: false, reason: 'remove-failed', error: errorMessage(error) };
  }

  try {
    const cacheRoot = path.resolve(String(homeDir || os.homedir()), '.dsh', 'storages', 'session_projcache');
    const cacheFile = path.join(cacheRoot, 'sessions', sessionId + '.json');
    const guardedCache = guardInsideRoot(cacheRoot, cacheFile);
    if (guardedCache) await fsp.rm(guardedCache, { force: true });
  } catch (error) {
    warnings.push('projcache: ' + errorMessage(error));
  }

  return { removed: true };
}

/**
 * Delete the given sessions after re-verifying each one is still empty. Every
 * id is judged on its own: one failure never aborts the batch.
 */
export async function deleteSessions(ctx, sessionIds, options = {}) {
  const homeDir = typeof options.homeDir === 'string' && options.homeDir ? options.homeDir : os.homedir();
  const recheckTimeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : SCAN_TIMEOUT_MS;
  const query = getService(ctx, 'sessionQuery');
  const items = [];
  const seen = new Set();
  const summary = { total: 0, success: 0, failed: 0, skipped: 0 };

  for (const raw of Array.isArray(sessionIds) ? sessionIds : []) {
    summary.total += 1;
    const sessionId = typeof raw === 'string' ? raw.trim() : '';

    if (!sessionId || !isSafeSessionId(sessionId)) {
      summary.skipped += 1;
      items.push({ sessionId: sessionId || String(raw ?? ''), status: 'skipped', code: 'invalid-session-id', reason: 'invalid-session-id' });
      continue;
    }
    if (seen.has(sessionId)) {
      summary.skipped += 1;
      items.push({ sessionId, status: 'skipped', code: 'duplicate', reason: 'duplicate' });
      continue;
    }
    seen.add(sessionId);

    let record;
    try {
      record = await readSessionRecord(ctx, query, homeDir, sessionId, Date.now() + recheckTimeoutMs);
    } catch (error) {
      summary.skipped += 1;
      items.push({ sessionId, status: 'skipped', code: 'recheck-failed', reason: 'recheck-failed', error: errorMessage(error) });
      continue;
    }

    const recheck = summarizeSessionEvents(record.events);
    if (recheck.hasUserPrompt || recheck.hasTurnStart) {
      summary.skipped += 1;
      items.push({ sessionId, status: 'skipped', code: 'not-empty', reason: 'not-empty' });
      continue;
    }
    if (isLiveActive(ctx, sessionId)) {
      summary.skipped += 1;
      items.push({ sessionId, status: 'skipped', code: 'live-active', reason: 'live-active' });
      continue;
    }

    const warnings = [];
    await disposeLiveSession(ctx, sessionId, warnings);
    const detached = await detachLiveSession(ctx, sessionId, warnings);
    if (!detached) {
      try {
        if (typeof ctx?.emit === 'function') ctx.emit('session/disposed', { id: sessionId });
      } catch (error) {
        warnings.push('emit: ' + errorMessage(error));
      }
    }
    await detachFromWorkspaces(ctx, sessionId, warnings);
    await unarchiveSession(ctx, sessionId, warnings);

    const removal = await removeSessionArtifacts(homeDir, sessionId, warnings);
    if (!removal.removed) {
      summary.skipped += 1;
      const item = { sessionId, status: 'skipped', code: removal.reason, reason: removal.reason };
      if (removal.error) item.error = removal.error;
      if (warnings.length) item.warnings = warnings;
      items.push(item);
      continue;
    }

    summary.success += 1;
    const item = { sessionId, status: 'success' };
    if (warnings.length) item.warnings = warnings;
    items.push(item);
  }

  return { summary, items };
}

function readJsonBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req?.headers?.['content-length']);
    if (Number.isFinite(declared) && declared > limitBytes) {
      const error = new Error('request body exceeds ' + limitBytes + ' bytes');
      error.code = 'body-too-large';
      reject(error);
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limitBytes) {
        settled = true;
        const error = new Error('request body exceeds ' + limitBytes + ' bytes');
        error.code = 'body-too-large';
        reject(error);
        try {
          req.destroy?.();
        } catch (_) {}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

// #region auto-skills — persisted name list, HTTP surface, pre-step injection

/** Validate one candidate skill name; the same alphabet the slash gesture uses. */
export function isSkillName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && SKILL_NAME_RE.test(value);
}

/**
 * Normalise an untrusted skill-name list: keep only valid, non-duplicate names,
 * capped at AUTO_SKILLS_LIMIT. Returns null when the input is not an array, so
 * callers can distinguish "empty" from "malformed".
 */
export function normalizeAutoSkills(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const entry of value) {
    if (!isSkillName(entry)) continue;
    if (out.includes(entry)) continue;
    if (out.length >= AUTO_SKILLS_LIMIT) break;
    out.push(entry);
  }
  return out;
}

/** State file path: <home>/.dsh/dsh-self-use/auto-skills.json (absolute, guardable). */
export function autoSkillsPaths(homeDir) {
  const base = typeof homeDir === 'string' && homeDir ? homeDir : os.homedir();
  const root = path.resolve(base, '.dsh');
  const dir = path.join(root, AUTO_CLEANUP_DIR);
  return { root, dir, file: path.join(dir, AUTO_SKILLS_FILE) };
}

// The pre-step hook runs on every agent step, so the file is only re-read when
// its mtime or size changed; a missing file caches as an empty list too.
const autoSkillsCache = new Map();

/**
 * Read the persisted auto-skill list. A missing file, broken JSON, an unreadable
 * directory or a hostile path all degrade to an empty list; this never throws
 * because the pre-step hook calls it on every turn.
 */
export function readAutoSkillsConfig(homeDir) {
  let file;
  try {
    file = autoSkillsPaths(homeDir).file;
  } catch (_) {
    return { skills: [], updatedAt: 0 };
  }

  let stamp = 'missing';
  try {
    const stat = fs.statSync(file);
    stamp = stat.mtimeMs + ':' + stat.size;
  } catch (_) {
    stamp = 'missing';
  }
  const cached = autoSkillsCache.get(file);
  if (cached !== undefined && cached.stamp === stamp) return { skills: cached.skills, updatedAt: cached.updatedAt };
  if (stamp === 'missing') {
    const empty = { skills: [], updatedAt: 0 };
    autoSkillsCache.set(file, { stamp, skills: empty.skills, updatedAt: 0 });
    return empty;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    const empty = { skills: [], updatedAt: 0 };
    autoSkillsCache.set(file, { stamp, skills: empty.skills, updatedAt: 0 });
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { skills: [], updatedAt: 0 };
  const skills = normalizeAutoSkills(parsed.skills) ?? [];
  const updatedAt = Number.isFinite(parsed.updatedAt) && parsed.updatedAt > 0 ? Math.floor(parsed.updatedAt) : 0;
  autoSkillsCache.set(file, { stamp, skills, updatedAt });
  return { skills, updatedAt };
}

/**
 * Atomically persist the list: write <file>.tmp in the same directory, then
 * rename over the target, so a crash can never leave a half-written file.
 */
export function writeAutoSkillsConfig(homeDir, skills) {
  const paths = autoSkillsPaths(homeDir);
  const tmp = paths.file + '.tmp';
  // Absolute-path prefix assertion: refuse anything outside <home>/.dsh.
  const guardedFile = guardInsideRoot(paths.root, paths.file);
  const guardedTmp = guardInsideRoot(paths.root, tmp);
  if (!guardedFile || !guardedTmp) throw new Error('auto-skills path guard rejected');

  const list = normalizeAutoSkills(skills) ?? [];
  const next = { skills: list, updatedAt: Date.now() };
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(guardedTmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(guardedTmp, guardedFile);
  autoSkillsCache.delete(guardedFile);
  return next;
}

// The plugin cannot import @deepseek-ai/dsh-skill (it is not a resolvable
// dependency of this package), so the model-facing block is reproduced here
// verbatim from dsh-skill/lib/index.js:57-78 (renderSkillContent).
function escapeSkillAttr(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function escapeSkillText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderSkillResourceHint(skill) {
  const base = skill.resourceBase;
  if (!base || typeof base !== 'object') {
    return [
      'Resources for this skill are managed by provider "' + escapeSkillText(skill.provider ?? '') + '".',
      'Load referenced resources only as needed.'
    ];
  }
  if (base.kind === 'directory') {
    return [
      'Base directory for this skill: ' + escapeSkillText(base.path),
      'Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.'
    ];
  }
  if (base.kind === 'url') {
    return [
      'Base URL for this skill: ' + escapeSkillText(base.url),
      'Resolve relative URLs mentioned by this skill against the base URL before using them. Load referenced resources only as needed.'
    ];
  }
  return [
    'Resources for this skill: ' + escapeSkillText(base.description ?? ''),
    'Load referenced resources only as needed.'
  ];
}

/** The canonical <skill_content> block the model sees on every skill path. */
export function renderSkillContent(skill) {
  const content = typeof skill.content === 'string' ? skill.content : '';
  return [
    '<skill_content name="' + escapeSkillAttr(skill.name) + '">',
    '<skill_resources>',
    ...renderSkillResourceHint(skill),
    '</skill_resources>',
    '',
    '<skill_instructions>',
    content,
    '</skill_instructions>',
    '</skill_content>'
  ].join('\n');
}

/** A user-role injection message shaped like dsh-llm createUserMessage. */
function createSkillInjectionMessage(name, text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'skill-invocation', name, form: 'instructions' })
  });
}

/** Whether one claimed message is a genuine human prompt (not injected context). */
function isHumanMessage(message) {
  if (!message || typeof message !== 'object') return false;
  const source = message.source && typeof message.source === 'object' ? message.source : null;
  if (source && source.kind !== 'user') return false;
  return message.role === 'user' || source !== null;
}

/** Skill names already injected in this decision, so one step never doubles up. */
function injectedSkillNames(messages) {
  const names = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') continue;
    const source = message.source && typeof message.source === 'object' ? message.source : null;
    if (!source || source.kind !== 'skill-invocation') continue;
    if (typeof source.name === 'string' && !names.includes(source.name)) names.push(source.name);
  }
  return names;
}

/**
 * Resolve the workspace directory for a skill lookup, tolerating hosts that do
 * not expose a working-directory service.
 */
async function skillLookupOptions(ctx, agent, signal) {
  const options = { scope: agent, signal };
  try {
    const workingDirectory = getService(ctx, 'workingDirectory');
    if (workingDirectory && typeof workingDirectory.ensure === 'function') {
      const cwd = await workingDirectory.ensure(agent, signal);
      if (typeof cwd === 'string' && cwd) options.cwd = cwd;
    }
  } catch (_) {}
  return options;
}

/**
 * Build the injection messages for one step. Every failure path yields an empty
 * list: an unusable skill registry must never block or crash a conversation.
 */
async function buildSkillInjections(ctx, homeDir, agent, signal, already) {
  const config = readAutoSkillsConfig(homeDir);
  if (config.skills.length === 0) return [];
  const skills = getService(ctx, 'skills');
  if (!skills || typeof skills.get !== 'function') return [];
  const options = await skillLookupOptions(ctx, agent, signal);
  const injections = [];
  for (const name of config.skills) {
    if (already.includes(name)) continue;
    try {
      const skill = await skills.get(name, options);
      if (!skill || typeof skill !== 'object') continue;
      const invocation = skill.invocation && typeof skill.invocation === 'object' ? skill.invocation : null;
      if (invocation && invocation.userInvocable === false) continue;
      injections.push(createSkillInjectionMessage(name, renderSkillContent(skill)));
    } catch (_) {
      // One broken skill never drops the rest, and never aborts the turn.
    }
  }
  return injections;
}

/**
 * Register the agent/pre-step hook that auto-attaches every selected skill.
 * Injection happens only on a step that claims real human input, which is
 * exactly "the user just sent a message" — continuation steps and goal wakes
 * are left untouched, so the context never grows on its own.
 */
export function installAutoSkillInjection(ctx, options = {}) {
  if (!ctx || typeof ctx.on !== 'function') return () => {};
  const homeDir = typeof options.homeDir === 'string' && options.homeDir ? options.homeDir : undefined;

  const listener = async (payload, next) => {
    const decision = await next();
    try {
      if (!decision || decision.kind === 'reject') return decision;
      const claimed = Array.isArray(payload?.messages) ? payload.messages : [];
      if (!claimed.some(isHumanMessage)) return decision;
      const messages = Array.isArray(decision.messages) ? decision.messages : [];
      const already = injectedSkillNames(messages);
      const injections = await buildSkillInjections(ctx, homeDir, payload?.agent, payload?.signal, already);
      if (injections.length === 0) return decision;
      return { ...decision, messages: [...messages, ...injections] };
    } catch (_) {
      // Any failure returns the untouched decision: never break the turn.
      return decision;
    }
  };

  const dispose = ctx.on('agent/pre-step', listener);
  const cleanup = typeof dispose === 'function' ? dispose : () => {};
  if (typeof ctx.effect === 'function') ctx.effect(() => cleanup, 'dsh-self-use: auto-skill injection');
  return cleanup;
}
// #endregion

// #region auto-cleanup — persisted config, background sweep, one-shot tick

function clampAutoMinutes(value) {
  if (!Number.isInteger(value)) return AUTO_CLEANUP_DEFAULT_MINUTES;
  if (value < AUTO_CLEANUP_MIN_MINUTES || value > AUTO_CLEANUP_MAX_MINUTES) return AUTO_CLEANUP_DEFAULT_MINUTES;
  return value;
}

function normalizeLastRun(value) {
  if (!value || typeof value !== 'object') return null;
  const at = Number.isFinite(value.at) && value.at >= 0 ? value.at : 0;
  const deleted = Number.isFinite(value.deleted) && value.deleted >= 0 ? Math.floor(value.deleted) : 0;
  return { at, deleted };
}

/**
 * The auto-cleanup state file lives at <home>/.dsh/dsh-self-use/auto-cleanup.json.
 * Resolved as an absolute path so every write can be prefix-asserted first.
 */
export function autoCleanupPaths(homeDir) {
  const base = typeof homeDir === 'string' && homeDir ? homeDir : os.homedir();
  const root = path.resolve(base, '.dsh');
  const dir = path.join(root, AUTO_CLEANUP_DIR);
  return { root, dir, file: path.join(dir, AUTO_CLEANUP_FILE) };
}

/**
 * Read the persisted auto-cleanup config. A missing file, a broken file, an
 * unreadable directory or a hostile path all fall back to the defaults; this
 * function never throws, because the timer calls it on every tick.
 */
export function readAutoCleanupConfig(homeDir) {
  const defaults = { enabled: false, minutes: AUTO_CLEANUP_DEFAULT_MINUTES, lastRun: null };
  let file;
  try {
    file = autoCleanupPaths(homeDir).file;
  } catch (_) {
    return defaults;
  }

  let parsed;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    parsed = JSON.parse(raw);
  } catch (_) {
    return defaults;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;

  return {
    enabled: parsed.enabled === true,
    minutes: clampAutoMinutes(parsed.minutes),
    lastRun: normalizeLastRun(parsed.lastRun)
  };
}

/**
 * Atomically persist the config: write <file>.tmp inside the same directory,
 * then rename over the target so a crash can never leave a half-written file.
 * The patch is merged over the value currently on disk.
 */
export function writeAutoCleanupConfig(homeDir, patch) {
  const paths = autoCleanupPaths(homeDir);
  const file = paths.file;
  const tmp = file + '.tmp';

  // Absolute-path prefix assertion: refuse anything outside <home>/.dsh.
  const guardedFile = guardInsideRoot(paths.root, file);
  const guardedTmp = guardInsideRoot(paths.root, tmp);
  if (!guardedFile || !guardedTmp) throw new Error('auto-cleanup path guard rejected');

  const current = readAutoCleanupConfig(homeDir);
  const incoming = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const next = {
    enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : current.enabled,
    minutes: clampAutoMinutes(Number.isInteger(incoming.minutes) ? incoming.minutes : current.minutes),
    lastRun: Object.prototype.hasOwnProperty.call(incoming, 'lastRun')
      ? normalizeLastRun(incoming.lastRun)
      : current.lastRun
  };

  fs.mkdirSync(paths.dir, { recursive: true });
  const payload = JSON.stringify(next, null, 2) + '\n';
  fs.writeFileSync(guardedTmp, payload, 'utf8');
  fs.renameSync(guardedTmp, guardedFile);
  return next;
}

function resolveAutoIntervalMs(explicit, env) {
  const candidates = [explicit, env];
  for (const value of candidates) {
    const number = typeof value === 'string' ? Number(value) : value;
    if (Number.isFinite(number) && number > 0) return Math.floor(number);
  }
  return AUTO_CLEANUP_INTERVAL_MS;
}

/**
 * Run one auto-cleanup sweep. Pure enough to drive from a test: it takes the
 * ctx and options, performs the scan/verify/delete sequence and returns what
 * happened. Every candidate must be empty, older than the threshold, and not a
 * live running session; deleteSessions re-verifies emptiness before removing.
 */
export async function tickAutoCleanup(ctx, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const homeDir = typeof opts.homeDir === 'string' && opts.homeDir ? opts.homeDir : os.homedir();
  const now = Number.isFinite(opts.now) && opts.now > 0 ? opts.now : Date.now();

  let config;
  try {
    config = readAutoCleanupConfig(homeDir);
  } catch (_) {
    return { ran: false, reason: 'config-unreadable', deleted: 0, scanned: 0, candidates: [] };
  }
  if (config.enabled !== true) return { ran: false, reason: 'disabled', deleted: 0, scanned: 0, candidates: [] };

  const cutoff = now - config.minutes * 60000;
  const scan = await collectEmptySessions(ctx, { homeDir });

  const candidates = [];
  for (const session of scan.sessions) {
    if (!session || typeof session !== 'object') continue;
    const sessionId = typeof session.sessionId === 'string' ? session.sessionId : '';
    if (!sessionId) continue;
    // An unknown creation time is never old enough to be deleted automatically.
    if (!Number.isFinite(session.createdAt) || session.createdAt >= cutoff) continue;
    // The scan already drops live sessions; this is the second line of defence.
    if (isLiveActive(ctx, sessionId)) continue;
    candidates.push(sessionId);
  }

  if (!candidates.length) {
    return { ran: true, reason: 'nothing-to-delete', deleted: 0, scanned: scan.sessions.length, candidates: [] };
  }

  const outcome = await deleteSessions(ctx, candidates, { homeDir });
  const deleted = outcome && outcome.summary && Number.isFinite(outcome.summary.success) ? outcome.summary.success : 0;

  if (deleted > 0) {
    try {
      writeAutoCleanupConfig(homeDir, { lastRun: { at: now, deleted } });
    } catch (error) {
      console.warn('[dsh-self-use] auto-cleanup: failed to persist lastRun: ' + errorMessage(error));
    }
  }

  return { ran: true, reason: deleted > 0 ? 'deleted' : 'nothing-deleted', deleted, scanned: scan.sessions.length, candidates };
}

// #endregion auto-cleanup

export function apply(ctx, pluginOptions) {
  const opts = pluginOptions && typeof pluginOptions === 'object' ? pluginOptions : {};
  // A test harness (or an embedded host) may pin the home directory; production
  // leaves it undefined so every helper falls back to os.homedir().
  const homeDir = typeof opts.homeDir === 'string' && opts.homeDir ? opts.homeDir : undefined;

  function sendJson(res, statusCode, data) {
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(payload);
  }

  async function getEventsForSession(sessionId) {
    let failure = null;

    try {
      const live = ctx.sessions?.get?.(sessionId);
      if (live && typeof live.snapshotEvents === 'function') {
        const events = await live.snapshotEvents();
        if (Array.isArray(events)) return events;
      }
    } catch (e) {
      failure = failure || e;
    }

    try {
      const query = typeof ctx.get === 'function' ? ctx.get('sessionQuery') : null;
      if (query && typeof query.readSession === 'function') {
        const stored = await query.readSession(sessionId);
        if (stored && Array.isArray(stored.events)) return stored.events;
      }
    } catch (e) {
      failure = failure || e;
    }

    if (failure) throw failure;
    return [];
  }

  async function handler(req, res) {
    try {
      const url = new URL(req?.url || '/', 'http://127.0.0.1');
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      const method = String(req?.method || 'GET').toUpperCase();

      if (pathname === PREFIX + '/health') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return sendJson(res, 200, { ok: true, version: VERSION });
      }

      if (pathname === PREFIX + '/prompts') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, prompts: [], error: 'method not allowed' });
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) {
          return sendJson(res, 400, { ok: false, prompts: [], error: 'sessionId required' });
        }
        try {
          const events = await getEventsForSession(sessionId);
          return sendJson(res, 200, { ok: true, prompts: extractPrompts(events) });
        } catch (e) {
          return sendJson(res, 200, { ok: false, prompts: [], error: errorMessage(e) });
        }
      }

      if (pathname === PREFIX + '/empty-sessions') {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, sessions: [], error: 'method not allowed' });
        try {
          const outcome = await collectEmptySessions(ctx, { homeDir });
          const sessions = Array.isArray(outcome?.sessions) ? outcome.sessions : [];
          const skipped = Array.isArray(outcome?.skipped) ? outcome.skipped : [];
          // ok is pinned here rather than forwarded from the scan object so the
          // HTTP contract holds even if a future scan result drops the field.
          return sendJson(res, 200, {
            ok: true,
            sessions,
            skipped,
            partial: outcome?.partial === true
          });
        } catch (e) {
          return sendJson(res, 500, { ok: false, sessions: [], skipped: [], error: errorMessage(e) });
        }
      }

      if (pathname === PREFIX + '/empty-sessions/delete') {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' });

        let raw;
        try {
          raw = await readJsonBody(req, DELETE_BODY_LIMIT);
        } catch (e) {
          if (e && e.code === 'body-too-large') {
            return sendJson(res, 400, { ok: false, error: 'request body exceeds 64 KiB', code: 'body-too-large' });
          }
          return sendJson(res, 400, { ok: false, error: errorMessage(e), code: 'body-unreadable' });
        }

        let body;
        try {
          body = raw.trim() ? JSON.parse(raw) : {};
        } catch (_) {
          return sendJson(res, 400, { ok: false, error: 'request body must be JSON', code: 'invalid-json' });
        }

        const sessionIds = body && typeof body === 'object' ? body.sessionIds : undefined;
        if (!Array.isArray(sessionIds)) {
          return sendJson(res, 400, { ok: false, error: 'sessionIds must be an array', code: 'invalid-sessionIds' });
        }
        if (sessionIds.length > DELETE_BATCH_LIMIT) {
          return sendJson(res, 400, {
            ok: false,
            error: 'at most ' + DELETE_BATCH_LIMIT + ' sessionIds per request',
            code: 'batch-too-large'
          });
        }

        try {
          const result = await deleteSessions(ctx, sessionIds, { homeDir });
          return sendJson(res, 200, { ok: true, result });
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: errorMessage(e) });
        }
      }

      if (pathname === PREFIX + '/auto-skills') {
        if (method === 'GET') {
          try {
            const config = readAutoSkillsConfig(homeDir);
            return sendJson(res, 200, { ok: true, skills: config.skills, updatedAt: config.updatedAt });
          } catch (e) {
            return sendJson(res, 500, { ok: false, skills: [], error: errorMessage(e) });
          }
        }

        if (method === 'POST') {
          let raw;
          try {
            raw = await readJsonBody(req, AUTO_SKILLS_BODY_LIMIT);
          } catch (e) {
            if (e && e.code === 'body-too-large') {
              return sendJson(res, 400, { ok: false, skills: [], error: 'request body exceeds 16 KiB', code: 'body-too-large' });
            }
            return sendJson(res, 400, { ok: false, skills: [], error: errorMessage(e), code: 'body-unreadable' });
          }

          let body;
          try {
            body = raw.trim() ? JSON.parse(raw) : {};
          } catch (_) {
            return sendJson(res, 400, { ok: false, skills: [], error: 'request body must be JSON', code: 'invalid-json' });
          }

          const incoming = body && typeof body === 'object' ? body.skills : undefined;
          if (!Array.isArray(incoming)) {
            return sendJson(res, 400, { ok: false, skills: [], error: 'skills must be an array', code: 'invalid-skills' });
          }
          if (incoming.length > AUTO_SKILLS_LIMIT) {
            return sendJson(res, 400, {
              ok: false,
              skills: [],
              error: 'at most ' + AUTO_SKILLS_LIMIT + ' skills per request',
              code: 'invalid-skills'
            });
          }
          for (const entry of incoming) {
            if (!isSkillName(entry)) {
              return sendJson(res, 400, {
                ok: false,
                skills: [],
                error: 'each skill name must match /^[\\w-]+$/ and be non-empty',
                code: 'invalid-skills'
              });
            }
          }

          try {
            const config = writeAutoSkillsConfig(homeDir, incoming);
            return sendJson(res, 200, { ok: true, skills: config.skills, updatedAt: config.updatedAt });
          } catch (e) {
            return sendJson(res, 500, { ok: false, skills: [], error: errorMessage(e) });
          }
        }

        return sendJson(res, 405, { ok: false, skills: [], error: 'method not allowed' });
      }

      if (pathname === PREFIX + '/model-custom') {
        if (method === 'GET') {
          try {
            const config = readModelCustom(homeDir);
            return sendJson(res, 200, {
              ok: true,
              config: {
                efforts: config.efforts,
                hidden: config.hidden,
                hiddenGroups: config.hiddenGroups,
                updatedAt: config.updatedAt
              }
            });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: errorMessage(e) });
          }
        }

        if (method === 'POST') {
          let raw;
          try {
            raw = await readJsonBody(req, MODEL_CUSTOM_BODY_LIMIT);
          } catch (e) {
            if (e && e.code === 'body-too-large') {
              return sendJson(res, 400, { ok: false, error: 'request body exceeds 256 KiB', code: 'body-too-large' });
            }
            return sendJson(res, 400, { ok: false, error: errorMessage(e), code: 'body-unreadable' });
          }

          let body;
          try {
            body = raw.trim() ? JSON.parse(raw) : {};
          } catch (_) {
            return sendJson(res, 400, { ok: false, error: 'request body must be JSON', code: 'invalid-json' });
          }
          if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            return sendJson(res, 400, { ok: false, error: 'body must be an object', code: 'invalid-body' });
          }
          if (body.efforts !== undefined && (body.efforts === null || typeof body.efforts !== 'object' || Array.isArray(body.efforts))) {
            return sendJson(res, 400, { ok: false, error: 'efforts must be an object', code: 'invalid-efforts' });
          }
          if (body.hidden !== undefined && !Array.isArray(body.hidden)) {
            return sendJson(res, 400, { ok: false, error: 'hidden must be an array', code: 'invalid-hidden' });
          }
          if (body.hiddenGroups !== undefined && !Array.isArray(body.hiddenGroups)) {
            return sendJson(res, 400, { ok: false, error: 'hiddenGroups must be an array', code: 'invalid-hidden-groups' });
          }

          try {
            const config = writeModelCustom(homeDir, body);
            return sendJson(res, 200, {
              ok: true,
              config: {
                efforts: config.efforts,
                hidden: config.hidden,
                hiddenGroups: config.hiddenGroups,
                updatedAt: config.updatedAt
              }
            });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: errorMessage(e) });
          }
        }

        return sendJson(res, 405, { ok: false, error: 'method not allowed' });
      }

      if (pathname === PREFIX + '/question-wait') {
        if (method === 'GET') {
          try {
            const config = readQuestionWaitConfig(homeDir);
            return sendJson(res, 200, { ok: true, config: { minutes: config.minutes, updatedAt: config.updatedAt } });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: errorMessage(e) });
          }
        }

        if (method === 'POST') {
          let raw;
          try {
            raw = await readJsonBody(req, QUESTION_WAIT_BODY_LIMIT);
          } catch (e) {
            if (e && e.code === 'body-too-large') {
              return sendJson(res, 400, { ok: false, error: 'request body exceeds 4 KiB', code: 'body-too-large' });
            }
            return sendJson(res, 400, { ok: false, error: errorMessage(e), code: 'body-unreadable' });
          }

          let body;
          try {
            body = raw.trim() ? JSON.parse(raw) : {};
          } catch (_) {
            return sendJson(res, 400, { ok: false, error: 'request body must be JSON', code: 'invalid-json' });
          }
          if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            return sendJson(res, 400, { ok: false, error: 'body must be an object', code: 'invalid-body' });
          }

          // 只带 activity 的请求表示「输入框刚变化」，只重置计时，不改配置。
          if (body.activity === true && body.minutes === undefined) {
            markQuestionActivity();
            return sendJson(res, 200, { ok: true, activity: true });
          }

          const minutes = Number(body.minutes);
          if (!Number.isFinite(minutes)) {
            return sendJson(res, 400, { ok: false, error: 'minutes must be a number', code: 'invalid-minutes' });
          }
          try {
            const config = writeQuestionWaitConfig(homeDir, minutes);
            markQuestionActivity();
            return sendJson(res, 200, { ok: true, config: { minutes: config.minutes, updatedAt: config.updatedAt } });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: errorMessage(e) });
          }
        }

        return sendJson(res, 405, { ok: false, error: 'method not allowed' });
      }

      if (pathname === PREFIX + FILE_ROUTE) {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        const target = url.searchParams.get('path') || '/';
        try {
          const listing = await listDirectory(target);
          return sendJson(res, 200, { ok: true, listing });
        } catch (e) {
          return sendJson(res, 200, { ok: false, error: errorMessage(e), listing: null });
        }
      }

      if (pathname === PREFIX + FILE_DELETE_ROUTE) {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        let raw;
        try {
          raw = await readJsonBody(req, AUTO_BODY_LIMIT);
        } catch (e) {
          return sendJson(res, 400, { ok: false, error: errorMessage(e), code: 'body-unreadable' });
        }
        let body;
        try {
          body = raw.trim() ? JSON.parse(raw) : {};
        } catch (_) {
          return sendJson(res, 400, { ok: false, error: 'request body must be JSON', code: 'invalid-json' });
        }
        if (typeof body?.path !== 'string' || body.path.trim() === '') {
          return sendJson(res, 400, { ok: false, error: 'path is required', code: 'invalid-path' });
        }
        try {
          const result = await deletePath(body.path);
          return sendJson(res, 200, { ok: true, result });
        } catch (e) {
          return sendJson(res, 200, { ok: false, error: errorMessage(e) });
        }
      }

      if (pathname === PREFIX + FILE_DOWNLOAD_ROUTE) {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
        const target = url.searchParams.get('path') || '';
        let info;
        try {
          info = await statForDownload(target);
        } catch (e) {
          return sendJson(res, 404, { ok: false, error: errorMessage(e) });
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(info.size));
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="' + info.name.replace(/["\\]/g, '_') + '"'
        );
        const stream = fs.createReadStream(info.path);
        stream.on('error', () => {
          try { res.destroy(); } catch (_) {}
        });
        stream.pipe(res);
        return undefined;
      }

      if (pathname === PREFIX + '/prefs') {
        if (method === 'GET') {
          try {
            return sendJson(res, 200, { ok: true, prefs: readPrefs(homeDir) });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: errorMessage(e) });
          }
        }

        if (method === 'POST') {
          let raw;
          try {
            raw = await readJsonBody(req, AUTO_BODY_LIMIT);
          } catch (e) {
            if (e && e.code === 'body-too-large') {
              return sendJson(res, 400, { ok: false, error: 'request body exceeds 8 KiB', code: 'body-too-large' });
            }
            return sendJson(res, 400, { ok: false, error: errorMessage(e), code: 'body-unreadable' });
          }

          let body;
          try {
            body = raw.trim() ? JSON.parse(raw) : {};
          } catch (_) {
            return sendJson(res, 400, { ok: false, error: 'request body must be JSON', code: 'invalid-json' });
          }

          if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            return sendJson(res, 400, { ok: false, error: 'body must be an object', code: 'invalid-body' });
          }

          try {
            const next = writePrefs(homeDir, body);
            return sendJson(res, 200, { ok: true, prefs: next });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: errorMessage(e) });
          }
        }

        return sendJson(res, 405, { ok: false, error: 'method not allowed' });
      }

      if (pathname === PREFIX + '/auto-cleanup') {
        if (method === 'GET') {
          try {
            const config = readAutoCleanupConfig(homeDir);
            return sendJson(res, 200, {
              ok: true,
              config: { enabled: config.enabled, minutes: config.minutes },
              lastRun: config.lastRun
            });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: errorMessage(e) });
          }
        }

        if (method === 'POST') {
          let raw;
          try {
            raw = await readJsonBody(req, AUTO_BODY_LIMIT);
          } catch (e) {
            if (e && e.code === 'body-too-large') {
              return sendJson(res, 400, { ok: false, error: 'request body exceeds 8 KiB', code: 'body-too-large' });
            }
            return sendJson(res, 400, { ok: false, error: errorMessage(e), code: 'body-unreadable' });
          }

          let body;
          try {
            body = raw.trim() ? JSON.parse(raw) : {};
          } catch (_) {
            return sendJson(res, 400, { ok: false, error: 'request body must be JSON', code: 'invalid-json' });
          }

          if (typeof body?.enabled !== 'boolean') {
            return sendJson(res, 400, { ok: false, error: 'enabled must be a boolean', code: 'invalid-enabled' });
          }
          const minutes = body?.minutes;
          if (!Number.isInteger(minutes) || minutes < AUTO_CLEANUP_MIN_MINUTES || minutes > AUTO_CLEANUP_MAX_MINUTES) {
            return sendJson(res, 400, {
              ok: false,
              error: 'minutes must be an integer between ' + AUTO_CLEANUP_MIN_MINUTES + ' and ' + AUTO_CLEANUP_MAX_MINUTES,
              code: 'invalid-minutes'
            });
          }

          try {
            const config = writeAutoCleanupConfig(homeDir, { enabled: body.enabled, minutes });
            return sendJson(res, 200, { ok: true, config: { enabled: config.enabled, minutes: config.minutes } });
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: errorMessage(e) });
          }
        }

        return sendJson(res, 405, { ok: false, error: 'method not allowed' });
      }

      return sendJson(res, 404, { ok: false, prompts: [], error: 'not found' });
    } catch (e) {
      try {
        return sendJson(res, 200, { ok: false, prompts: [], error: errorMessage(e) });
      } catch (_) {
        return undefined;
      }
    }
  }

  const register = () => {
    if (!ctx.webServer || typeof ctx.webServer.register !== 'function') return undefined;
    return ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler });
  };

  if (typeof ctx.effect === 'function') ctx.effect(register, 'dsh-self-use: http-route');
  else register();

  startAutoCleanupTimer(ctx, opts);
  installAutoSkillInjection(ctx, { homeDir });
  installQuestionWait(ctx, { homeDir });
}




// #region dsh-self-use: file manager (browse / delete / download)

const FILE_ROUTE = '/files';
const FILE_DELETE_ROUTE = '/files/delete';
const FILE_DOWNLOAD_ROUTE = '/files/download';
const FILE_MAX_ENTRIES = 5000;

/** 当前平台根目录：POSIX 是 /，Windows 是盘符根。 */
function platformRoot() {
  return path.parse(process.cwd()).root || (process.platform === 'win32' ? 'C:\\' : '/');
}

/**
 * 把客户端传来的路径解析成本机绝对路径。
 * POSIX 接受 /a/b；Windows 接受 C:\\a\\b、C:/a/b、\\\\server\\share，以及 /a/b（按当前盘符补全）。
 */
function resolveUserPath(raw) {
  const input = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : platformRoot();
  const resolved = path.resolve(input);
  if (!path.isAbsolute(resolved)) throw new Error('path must be absolute');
  return resolved;
}

/** 平台无关的根目录判断，用于拒绝删除根。 */
function isRootPath(target) {
  return path.dirname(target) === target;
}

/** 目录列举：名字、类型、大小、修改时间。 */
export async function listDirectory(dirPath) {
  const target = resolveUserPath(dirPath);
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (out.length >= FILE_MAX_ENTRIES) break;
    const full = path.join(target, entry.name);
    let size = 0;
    let modifiedAt = 0;
    try {
      const info = await fs.promises.stat(full);
      size = info.size;
      modifiedAt = info.mtimeMs;
    } catch (_) {}
    let type = 'other';
    if (entry.isDirectory()) type = 'directory';
    else if (entry.isFile()) type = 'file';
    else if (entry.isSymbolicLink()) type = 'symlink';
    out.push({ name: entry.name, path: full, type, size, modifiedAt });
  }
  out.sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory');
    return group !== 0 ? group : left.name.localeCompare(right.name);
  });
  const parentDir = path.dirname(target);
  return { path: target, parent: parentDir === target ? null : parentDir, entries: out };
}

/** 永久删除文件或整个目录树。 */
export async function deletePath(dirPath) {
  const target = resolveUserPath(dirPath);
  if (isRootPath(target)) throw new Error('refusing to delete root');
  await fs.promises.rm(target, { recursive: true, force: false });
  return { path: target, deleted: true };
}

/** 读取文件用于浏览器下载，返回绝对路径与大小，流式由调用方处理。 */
export async function statForDownload(dirPath) {
  const target = resolveUserPath(dirPath);
  const info = await fs.promises.stat(target);
  if (!info.isFile()) throw new Error('not a regular file');
  return { path: target, size: info.size, name: path.basename(target) };
}

// #endregion dsh-self-use: file manager (browse / delete / download)


// #region dsh-self-use: cross-origin preferences (Host-side)

const PREFS_FILE = 'prefs.json';
const PREFS_BOOL_FIELDS = ['autoFullAccess', 'stickyPrompt', 'promptSearch', 'autoCleanup', 'hideSubagentMentions', 'fileManager', 'imageRescue'];
const PREFS_MINUTES_MIN = 1;
const PREFS_MINUTES_MAX = 10080;
const PREFS_MINUTES_DEFAULT = 60;
const PREFS_SKILLS_MAX = 50;
const FILE_REFRESH_OPTIONS = [0, 2000, 5000, 10000, 30000];
const FILE_REFRESH_DEFAULT_MS = 5000;

function clampFileRefresh(value) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return FILE_REFRESH_DEFAULT_MS;
  if (num === 0) return 0;
  return FILE_REFRESH_OPTIONS.indexOf(num) >= 0 ? num : FILE_REFRESH_DEFAULT_MS;
}

function prefsPath(homeDir) {
  const base = typeof homeDir === 'string' && homeDir ? homeDir : os.homedir();
  return path.join(base, '.dsh', 'dsh-self-use', PREFS_FILE);
}

export function emptyPrefs() {
  const out = {};
  for (const field of PREFS_BOOL_FIELDS) out[field] = false;
  out.autoCleanupMinutes = PREFS_MINUTES_DEFAULT;
  out.autoSkills = [];
  out.fileRefreshMs = FILE_REFRESH_DEFAULT_MS;
  out.imageRescue = true;
  return out;
}

function clampPrefsMinutes(value) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return PREFS_MINUTES_DEFAULT;
  const rounded = Math.round(num);
  if (rounded < PREFS_MINUTES_MIN) return PREFS_MINUTES_MIN;
  if (rounded > PREFS_MINUTES_MAX) return PREFS_MINUTES_MAX;
  return rounded;
}

function normalizePrefsSkills(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of list) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (name === '' || name.length > 64) continue;
    if (out.indexOf(name) >= 0) continue;
    if (out.length >= PREFS_SKILLS_MAX) break;
    out.push(name);
  }
  return out;
}

export function readPrefs(homeDir) {
  const fallback = emptyPrefs();
  try {
    const raw = fs.readFileSync(prefsPath(homeDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    const out = emptyPrefs();
    for (const field of PREFS_BOOL_FIELDS) {
      if (typeof parsed[field] === 'boolean') out[field] = parsed[field];
    }
    out.autoCleanupMinutes = clampPrefsMinutes(parsed.autoCleanupMinutes);
    out.autoSkills = normalizePrefsSkills(parsed.autoSkills);
    out.fileRefreshMs = clampFileRefresh(parsed.fileRefreshMs);
    return out;
  } catch (_) {
    return fallback;
  }
}

export function writePrefs(homeDir, patch) {
  const current = readPrefs(homeDir);
  const source = patch !== null && typeof patch === 'object' ? patch : {};
  const next = emptyPrefs();
  for (const field of PREFS_BOOL_FIELDS) {
    next[field] = typeof source[field] === 'boolean' ? source[field] : current[field];
  }
  next.autoCleanupMinutes = clampPrefsMinutes(
    source.autoCleanupMinutes !== undefined ? source.autoCleanupMinutes : current.autoCleanupMinutes
  );
  next.autoSkills = normalizePrefsSkills(
    source.autoSkills !== undefined ? source.autoSkills : current.autoSkills
  );
  next.fileRefreshMs = clampFileRefresh(
    source.fileRefreshMs !== undefined ? source.fileRefreshMs : current.fileRefreshMs
  );
  next.updatedAt = Date.now();
  const file = prefsPath(homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

// #endregion dsh-self-use: cross-origin preferences (Host-side)


// #region dsh-self-use: model customisation (default effort + per-model hide)

const MODEL_CUSTOM_FILE = 'model-custom.json';
const MODEL_CUSTOM_BODY_LIMIT = 256 * 1024;
const MODEL_HIDE_STORAGE_KEY = 'dsh_self_use_hidden_models';
const MODEL_HIDE_GROUP_KEY = 'dsh_self_use_hidden_groups';

function modelCustomPath(homeDir) {
  const base = typeof homeDir === 'string' && homeDir ? homeDir : os.homedir();
  return path.join(base, '.dsh', 'dsh-self-use', MODEL_CUSTOM_FILE);
}

function emptyModelCustom() {
  return { efforts: {}, hidden: [], hiddenGroups: [], updatedAt: 0 };
}

export function readModelCustom(homeDir) {
  try {
    const raw = fs.readFileSync(modelCustomPath(homeDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyModelCustom();
    const efforts = {};
    if (parsed.efforts !== null && typeof parsed.efforts === 'object' && !Array.isArray(parsed.efforts)) {
      for (const key of Object.keys(parsed.efforts)) {
        const value = parsed.efforts[key];
        if (typeof value === 'string' && value !== '') efforts[key] = value;
      }
    }
    const strings = (value) =>
      Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry !== '') : [];
    return {
      efforts: efforts,
      hidden: strings(parsed.hidden),
      hiddenGroups: strings(parsed.hiddenGroups),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
    };
  } catch (_) {
    return emptyModelCustom();
  }
}

export function writeModelCustom(homeDir, patch) {
  const current = readModelCustom(homeDir);
  const source = patch !== null && typeof patch === 'object' ? patch : {};
  const next = {
    efforts: current.efforts,
    hidden: current.hidden,
    hiddenGroups: current.hiddenGroups,
    updatedAt: Date.now()
  };
  if (source.efforts !== null && typeof source.efforts === 'object' && !Array.isArray(source.efforts)) {
    const efforts = {};
    for (const key of Object.keys(source.efforts)) {
      const value = source.efforts[key];
      if (typeof value === 'string' && value !== '') efforts[key] = value;
    }
    next.efforts = efforts;
  }
  if (Array.isArray(source.hidden)) {
    next.hidden = source.hidden.filter((entry) => typeof entry === 'string' && entry !== '');
  }
  if (Array.isArray(source.hiddenGroups)) {
    next.hiddenGroups = source.hiddenGroups.filter((entry) => typeof entry === 'string' && entry !== '');
  }
  const file = modelCustomPath(homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

/** 模型唯一键：provider/model。 */
export function modelKey(provider, model) {
  const p = typeof provider === 'string' ? provider : '';
  const m = typeof model === 'string' ? model : '';
  if (p === '' || m === '') return '';
  return p + '/' + m;
}

/** 从配置里取某模型的默认强度；没有则返回 undefined（交回官方默认）。 */
export function effortForModel(config, provider, model) {
  const key = modelKey(provider, model);
  if (key === '') return undefined;
  const efforts = config !== null && typeof config === 'object' ? config.efforts : undefined;
  if (efforts === null || typeof efforts !== 'object') return undefined;
  const value = efforts[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** 该模型是否被隐藏。 */
export function isModelHidden(config, provider, model) {
  const key = modelKey(provider, model);
  if (key === '') return false;
  const hidden = config !== null && typeof config === 'object' ? config.hidden : undefined;
  return Array.isArray(hidden) && hidden.indexOf(key) >= 0;
}

/** 该模型组是否被隐藏。 */
export function isGroupHidden(config, provider) {
  if (typeof provider !== 'string' || provider === '') return false;
  const groups = config !== null && typeof config === 'object' ? config.hiddenGroups : undefined;
  return Array.isArray(groups) && groups.indexOf(provider) >= 0;
}

/**
 * 过滤模型目录：按隐藏清单移除被隐藏的模型与模型组，
 * 并把每个模型的默认强度换成自定义值。返回新对象，不改入参。
 */
export function applyModelCustomToCatalog(catalog, config) {
  if (catalog === null || typeof catalog !== 'object' || !Array.isArray(catalog.groups)) return catalog;
  const cfg = config !== null && typeof config === 'object' ? config : emptyModelCustom();
  const groups = [];
  for (const group of catalog.groups) {
    if (group === null || typeof group !== 'object') continue;
    if (isGroupHidden(cfg, group.id)) continue;
    const models = Array.isArray(group.models) ? group.models : [];
    const kept = [];
    for (const model of models) {
      if (model === null || typeof model !== 'object') continue;
      if (isModelHidden(cfg, group.id, model.id)) continue;
      const effort = effortForModel(cfg, group.id, model.id);
      if (effort === undefined) {
        kept.push(model);
        continue;
      }
      const reasoning = model.reasoning !== null && typeof model.reasoning === 'object' ? model.reasoning : undefined;
      kept.push(
        Object.assign({}, model, {
          reasoning: Object.assign({}, reasoning === undefined ? {} : reasoning, { defaultEffort: effort })
        })
      );
    }
    if (kept.length === 0) continue;
    groups.push(Object.assign({}, group, { models: kept }));
  }
  return Object.assign({}, catalog, { groups: groups });
}

/** 选中模型时套用自定义默认强度。 */
export function resolveCustomEffort(config, selection) {
  if (selection === null || typeof selection !== 'object') return selection;
  const effort = effortForModel(config, selection.provider, selection.model);
  if (effort === undefined) return selection;
  return Object.assign({}, selection, { reasoningEffort: effort });
}

// #endregion dsh-self-use: model customisation
// #region dsh-self-use: question wait (idle-reset budget)

const QUESTION_WAIT_FILE = 'question-wait.json';
const QUESTION_WAIT_BODY_LIMIT = 4 * 1024;
const QUESTION_WAIT_MIN_MINUTES = 1;
const QUESTION_WAIT_MAX_MINUTES = 1440;
const QUESTION_WAIT_DEFAULT_MINUTES = 10;
const QUESTION_PROGRAM_RE = /ask_user_question/;
const QUESTION_WATCHDOG_MS = 5000;

// 最近一次「输入框内容发生变化」的时刻；看门狗用它计算空闲时长。
let questionLastActivityAt = Date.now();

function questionWaitPath(homeDir) {
  const base = typeof homeDir === 'string' && homeDir ? homeDir : os.homedir();
  return path.join(base, '.dsh', 'dsh-self-use', QUESTION_WAIT_FILE);
}

export function clampQuestionMinutes(value) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return QUESTION_WAIT_DEFAULT_MINUTES;
  const rounded = Math.round(number);
  if (rounded < QUESTION_WAIT_MIN_MINUTES) return QUESTION_WAIT_MIN_MINUTES;
  if (rounded > QUESTION_WAIT_MAX_MINUTES) return QUESTION_WAIT_MAX_MINUTES;
  return rounded;
}

export function readQuestionWaitConfig(homeDir) {
  try {
    const raw = fs.readFileSync(questionWaitPath(homeDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') throw new Error('bad');
    return {
      minutes: clampQuestionMinutes(parsed.minutes),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
    };
  } catch (_) {
    return { minutes: QUESTION_WAIT_DEFAULT_MINUTES, updatedAt: 0 };
  }
}

export function writeQuestionWaitConfig(homeDir, minutes) {
  const next = { minutes: clampQuestionMinutes(minutes), updatedAt: Date.now() };
  const file = questionWaitPath(homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

/** 记录一次输入活动，重置所有提问的等待倒计时。 */
export function markQuestionActivity(now) {
  questionLastActivityAt = typeof now === 'number' ? now : Date.now();
  return questionLastActivityAt;
}

export function questionIdleMs(now) {
  const current = typeof now === 'number' ? now : Date.now();
  return Math.max(0, current - questionLastActivityAt);
}

/** 空闲时长是否已经超过配置的上限。 */
export function questionIdleExceeded(minutes, now) {
  const limit = clampQuestionMinutes(minutes) * 60000;
  return questionIdleMs(now) >= limit;
}

/**
 * 让提问不再被 run_code 的硬性墙钟切断：提问型程序取消 PTC 墙钟，
 * 改由空闲看门狗按「连续无输入时长」判定上限。输入框每次变化都会重置计时。
 */
export function installQuestionWait(ctx, options) {
  const opts = options !== null && typeof options === 'object' ? options : {};
  const homeDir = typeof opts.homeDir === 'string' ? opts.homeDir : os.homedir();
  if (typeof ctx.inject !== 'function') return undefined;

  ctx.inject(['ptcRuntime'], (ptcCtx) => {
    const runtime = ptcCtx && ptcCtx.ptcRuntime ? ptcCtx.ptcRuntime : undefined;
    if (!runtime || typeof runtime.resolve !== 'function' || typeof runtime.run !== 'function') return;
    if (runtime.__dshSelfUseQuestionWait === true) return;

    const originalResolve = runtime.resolve.bind(runtime);
    const originalRun = runtime.run.bind(runtime);
    const questionRuns = new Set();

    runtime.resolve = function patchedResolve(request) {
      const resolved = originalResolve(request);
      if (!QUESTION_PROGRAM_RE.test(String(resolved && resolved.program ? resolved.program : ''))) return resolved;
      // 提问型程序：取消墙钟，交给空闲看门狗。
      return Object.assign({}, resolved, { timeoutMs: null });
    };

    runtime.run = function patchedRun(spec) {
      if (!QUESTION_PROGRAM_RE.test(String(spec && spec.program ? spec.program : ''))) return originalRun(spec);
      const before = new Set(runtime.live || []);
      markQuestionActivity();
      const promise = originalRun(spec);
      const added = [];
      for (const entry of runtime.live || []) {
        if (!before.has(entry)) {
          questionRuns.add(entry);
          added.push(entry);
        }
      }
      return promise.finally(() => {
        for (const entry of added) questionRuns.delete(entry);
      });
    };

    runtime.__dshSelfUseQuestionWait = true;

    const timer = setInterval(() => {
      if (questionRuns.size === 0) return;
      const config = readQuestionWaitConfig(homeDir);
      if (!questionIdleExceeded(config.minutes)) return;
      const reason = new Error('提问等待超过 ' + config.minutes + ' 分钟且输入框无变化');
      for (const entry of questionRuns) {
        try {
          entry.controller.abort(reason);
        } catch (_) {}
      }
      questionRuns.clear();
    }, QUESTION_WATCHDOG_MS);
    if (typeof timer?.unref === 'function') timer.unref();

    const dispose = () => {
      clearInterval(timer);
      runtime.resolve = originalResolve;
      runtime.run = originalRun;
      runtime.__dshSelfUseQuestionWait = false;
      questionRuns.clear();
    };
    if (typeof ptcCtx.effect === 'function') ptcCtx.effect(() => dispose, 'dsh-self-use: question-wait');
    else dispose();
  });

  return undefined;
}

// #endregion dsh-self-use: question wait
/**
 * Start the background auto-cleanup timer and register its teardown on the
 * plugin effect, so the interval is always cleared when the plugin unloads.
 * Ticks are serialised: a tick that is still running makes the next one skip.
 */
export function startAutoCleanupTimer(ctx, pluginOptions) {
  const opts = pluginOptions && typeof pluginOptions === 'object' ? pluginOptions : {};
  const intervalMs = resolveAutoIntervalMs(opts.autoCleanupIntervalMs, process.env[AUTO_INTERVAL_ENV]);
  let running = false;

  const timer = setInterval(() => {
    if (running) return;
    running = true;
    Promise.resolve()
      .then(() => tickAutoCleanup(ctx, { homeDir: opts.homeDir }))
      .catch((error) => {
        console.warn('[dsh-self-use] auto-cleanup tick failed: ' + errorMessage(error));
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  // An interval alone must never hold the host process open.
  if (typeof timer?.unref === 'function') timer.unref();

  const dispose = () => {
    clearInterval(timer);
  };
  if (typeof ctx?.effect === 'function') ctx.effect(() => dispose, 'dsh-self-use: auto-cleanup-timer');
  else dispose();

  return dispose;
}
