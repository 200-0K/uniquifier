/**
 * This script can rename files uniquely per folder (Recursively)
 */
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs/promises');
const chalk = require('chalk');
const {
  fileExist,
  isFile,
  isDirectory,
  getFiles,
  writeFile,
  getFolders,
  renameFile,
} = require('./utils/FileManager');
const pLimit = require('p-limit');
const ProgressManager = require('./utils/ProgressManager');
const moment = require('moment/moment');

const workingDir = process.cwd();
const renamed = {};
let pendingChanges = 0;
let countLabels = {};

// Buffer errors so they do NOT print during progress
const errors = [];

/**
 * -----------------------------
 * Logging config (prevents bloat)
 * -----------------------------
 * Disable logs:
 *   UNIQUIFIER_LOG=0
 *
 * Keep last N logs (default 20):
 *   UNIQUIFIER_LOG_KEEP=30
 *
 * Delete logs older than X days (default 14):
 *   UNIQUIFIER_LOG_MAX_DAYS=7
 *
 * Cap total log dir size in MB (default 200):
 *   UNIQUIFIER_LOG_MAX_TOTAL_MB=100
 *
 * Log mode:
 *   UNIQUIFIER_LOG_MODE=full     (default, includes full "renamed" map)
 *   UNIQUIFIER_LOG_MODE=summary  (small log, no huge map)
 */
const LOG_DIR = path.resolve(__dirname, 'storage/log');
const LOG_ENABLED = !['0', 'false', 'off', 'no'].includes(
  String(process.env.UNIQUIFIER_LOG ?? '').toLowerCase()
);
const LOG_KEEP = Math.max(1, parseInt(process.env.UNIQUIFIER_LOG_KEEP || '50', 10));
const LOG_MAX_DAYS = Math.max(1, parseInt(process.env.UNIQUIFIER_LOG_MAX_DAYS || '14', 10));
const LOG_MAX_TOTAL_MB = Math.max(1, parseInt(process.env.UNIQUIFIER_LOG_MAX_TOTAL_MB || '200', 10));
const LOG_MAX_TOTAL_BYTES = LOG_MAX_TOTAL_MB * 1024 * 1024;
const LOG_MODE = String(process.env.UNIQUIFIER_LOG_MODE || 'full').toLowerCase(); // full|summary

let LOG_PATH = null;
let logWritten = false;
const startedAt = new Date();

function firstLine(msg) {
  if (!msg) return '';
  return String(msg).split(/\r?\n/)[0];
}

function ellipsizeStart(str, max) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - (max - 1));
}

function resolveConcurrency(progressStream = process.stderr) {
  const cpuCount =
    (typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : (os.cpus()?.length || 1));

  const rows =
    progressStream && progressStream.isTTY && typeof progressStream.rows === 'number'
      ? progressStream.rows
      : 0;

  // N worker lines + 1 overall line + a bit of breathing room.
  const maxByRows = rows > 0 ? Math.max(1, rows - 4) : Number.POSITIVE_INFINITY;

  const env = process.env.UNIQUIFIER_JOBS || process.env.JOBS;
  const forced = env ? parseInt(env, 10) : NaN;
  const base = Number.isFinite(forced) && forced > 0 ? forced : cpuCount;

  return Math.max(1, Math.min(base, maxByRows));
}

// Captures any stray console.error from other files (like FileManager) so it won’t break bars
function silenceConsoleError(progressManager) {
  const orig = console.error;
  console.error = (...args) => {
    try { progressManager.addError(1); } catch (_) { }
    errors.push({
      file: '(console.error)',
      code: 'STDERR',
      message: firstLine(args.map(a => (a && a.stack) ? a.stack : String(a)).join(' ')),
    });
  };
  return () => { console.error = orig; };
}

async function ensureLogReady() {
  if (!LOG_ENABLED) return;
  if (LOG_PATH) return;

  await fs.mkdir(LOG_DIR, { recursive: true });
  LOG_PATH = path.resolve(
    LOG_DIR,
    `${moment().format('YYYY-MM-DD_HH-mm-ss')}~${getRandomHex()}.json`
  );
}

function buildLogObject({ workingPath, finishedAt }) {
  const base = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    workingPath,
    totalRenamed: Object.keys(renamed).length,
    errorsCount: errors.length,
    errors: errors.map(e => ({
      file: e.file,
      code: e.code || 'ERR',
      message: firstLine(e.message),
    })),
  };

  if (LOG_MODE === 'summary') return base;

  // full mode: include mapping (can be large)
  return {
    ...base,
    renamed,
  };
}

async function saveLog(workingPath) {
  if (!LOG_ENABLED) return;

  // If nothing happened and no errors, skip creating a log file at all
  if (Object.keys(renamed).length === 0 && errors.length === 0) return;

  await ensureLogReady();
  const obj = buildLogObject({ workingPath, finishedAt: new Date() });

  await writeFile(LOG_PATH, JSON.stringify(obj, null, 2));
  logWritten = true;
  pendingChanges = 0;
}

async function cleanupLogs() {
  if (!LOG_ENABLED) return;

  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (_) { }

  let dirents;
  try {
    dirents = await fs.readdir(LOG_DIR, { withFileTypes: true });
  } catch (_) {
    return;
  }

  const jsonFiles = dirents
    .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.json'))
    .map(d => path.join(LOG_DIR, d.name));

  const stats = [];
  for (const file of jsonFiles) {
    try {
      const st = await fs.stat(file);
      stats.push({ file, mtimeMs: st.mtimeMs, size: st.size });
    } catch (_) { }
  }

  // 1) Delete by age
  const cutoff = Date.now() - LOG_MAX_DAYS * 24 * 60 * 60 * 1000;
  for (const s of stats) {
    if (s.mtimeMs < cutoff) {
      try { await fs.unlink(s.file); } catch (_) { }
    }
  }

  // refresh after deletes
  let remaining = [];
  try {
    const after = await fs.readdir(LOG_DIR, { withFileTypes: true });
    const files = after
      .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.json'))
      .map(d => path.join(LOG_DIR, d.name));

    for (const f of files) {
      try {
        const st = await fs.stat(f);
        remaining.push({ file: f, mtimeMs: st.mtimeMs, size: st.size });
      } catch (_) { }
    }
  } catch (_) {
    return;
  }

  // Sort newest -> oldest
  remaining.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // 2) Keep only last LOG_KEEP
  if (remaining.length > LOG_KEEP) {
    const toDelete = remaining.slice(LOG_KEEP);
    for (const s of toDelete) {
      try { await fs.unlink(s.file); } catch (_) { }
    }
    remaining = remaining.slice(0, LOG_KEEP);
  }

  // 3) Enforce total size cap (delete oldest until within limit)
  let total = remaining.reduce((acc, s) => acc + s.size, 0);
  if (total > LOG_MAX_TOTAL_BYTES) {
    // delete oldest first => iterate from end
    for (let i = remaining.length - 1; i >= 0 && total > LOG_MAX_TOTAL_BYTES; i--) {
      try {
        await fs.unlink(remaining[i].file);
        total -= remaining[i].size;
      } catch (_) { }
    }
  }
}

function printErrorReport(errs, { maxList = 60 } = {}) {
  if (!errs.length) return;

  const byCode = new Map();
  for (const e of errs) {
    const code = e.code || 'UNKNOWN';
    byCode.set(code, (byCode.get(code) || 0) + 1);
  }

  const summary = [...byCode.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code}:${n}`)
    .join('  ');

  console.log('\n' + chalk.redBright(`Errors (${errs.length})`));
  console.log(chalk.dim(summary));

  const list = errs.slice(0, maxList);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const idx = String(i + 1).padStart(2, '0');
    console.log(`${chalk.red(idx + '.')} ${chalk.yellow(`[${e.code || 'ERR'}]`)} ${ellipsizeStart(e.file, 120)}`);
    console.log(`    ${chalk.dim('→')} ${firstLine(e.message)}`);
  }

  if (errs.length > maxList) {
    console.log(chalk.dim(`...and ${errs.length - maxList} more`));
  }
}

main();
async function main() {
  if (!process.argv[2]) {
    console.error('You have to provide a location');
    return;
  }

  const workingPath = path.resolve(workingDir, process.argv[2]);
  if (!(await fileExist(workingPath))) {
    console.error('You have to provide a valid location');
    return;
  }

  // Cleanup old logs early (prevents bloat)
  await cleanupLogs();

  if (await isFile(workingPath)) {
    await prefixFile(workingPath);
    await saveLog(workingPath);
    if (logWritten) console.log(`Log File: ${LOG_PATH}`);
    return;
  }

  if (!(await isDirectory(workingPath))) {
    console.error(`Provide either a file path or a directory path`);
    return;
  }

  const folders = await getFolders(workingPath);
  const allFolders = [workingPath, ...folders];

  const PROGRESS_STREAM = process.stderr;
  const CONCURRENCY = resolveConcurrency(PROGRESS_STREAM);

  const limit = pLimit(CONCURRENCY);
  const progressManager = new ProgressManager(CONCURRENCY, allFolders.length, {
    stream: PROGRESS_STREAM,
  });

  const restoreConsoleError = silenceConsoleError(progressManager);

  progressManager.log(
    `Processing: ${workingPath} | workers=${CONCURRENCY} | log=${LOG_ENABLED ? LOG_MODE : 'off'}`
  );

  const tasks = allFolders.map(folder =>
    limit(() =>
      prefixFilesByFolder(folder, {
        logLabel: path.relative(workingPath, folder) || path.basename(folder),
        progressManager,
        workingPath,
      })
    )
  );

  await Promise.all(tasks);

  // final log + stop UI
  await saveLog(workingPath);
  progressManager.stop();
  restoreConsoleError();

  // Pretty errors at bottom
  printErrorReport(errors, { maxList: 60 });

  console.log(
    `Total: ${Object.values(countLabels).reduce((acc, cur) => acc + cur, 0)}`
  );

  if (logWritten) console.log(`Log File: ${LOG_PATH}`);
  else console.log(`Log File: (skipped — no changes/errors, or logging disabled)`);
}

async function prefixFilesByFolder(folder, { logLabel, progressManager, workingPath } = {}) {
  const unique = getUniqueText(path.basename(folder));
  logLabel = logLabel ?? path.basename(folder);

  const files = await getFiles(folder, '*.*', false);
  const handle = progressManager.acquireBar(logLabel, files.length || 1);

  // per-folder file concurrency (keep stable on Windows)
  const fileLimit = pLimit(50);

  await Promise.all(
    files.map(file =>
      fileLimit(async () => {
        const res = await prefixFile(file, unique);

        // Always advance bar so it doesn’t stall
        progressManager.updateBar(handle, 1, path.basename(file));

        if (!res.ok) {
          progressManager.addError(1);
          errors.push({
            file,
            code: res.error?.code || 'ERR',
            message: res.error?.message || 'rename failed',
          });
        }
      })
    )
  );

  if (files.length > 0) {
    countLabels[`Processed From '${logLabel}'`] =
      (countLabels[`Processed From '${logLabel}'`] || 0) + files.length;

    // Periodic log save every 100 changes (writes to SAME file; no bloat)
    if (pendingChanges > 100) {
      await saveLog(workingPath);
    }
  }

  progressManager.releaseBar(handle);
}

async function prefixFile(file, prefix = null) {
  const base = path.basename(file);
  prefix = prefix ?? getUniqueText(path.basename(path.dirname(file)));
  const renamePath = path.resolve(path.dirname(file), prefix + base);

  try {
    const result = await renameFile(file, renamePath);
    if (result) {
      renamed[file] = renamePath;
      pendingChanges++;
      return { ok: true };
    }
    return { ok: false, error: new Error('renameFile returned false') };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function getUniqueText(cryptoSuffix = null) {
  const randomCharacters = getRandomCharacters(5);
  let suffix = '';
  if (cryptoSuffix) {
    suffix = `-${crypto
      .createHash('md5')
      .update(cryptoSuffix)
      .digest('hex')
      .slice(0, 6)}`;
  }
  return `[${randomCharacters}${suffix}~]`;
}

function getRandomHex() {
  return Number(
    Date.now() * Math.round(Math.random() * 10000 + (Math.random() * 100 + 1))
  ).toString(16);
}

function getRandomCharacters(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let build = '';
  for (let i = 0; i < length; i++) {
    build += chars[Math.floor(Math.random() * chars.length)];
  }
  return build;
}
