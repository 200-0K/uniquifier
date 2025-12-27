/**
 * This script can rename files uniquely per folder (Recursively)
 */
const path = require('path');
const crypto = require('crypto');
const os = require('os');
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

const LOG_PATH = path.resolve(
  __dirname,
  `storage/log/${moment().format('YYYY-MM-DD_HH-mm-ss')}~${getRandomHex()}.json`
);

const workingDir = process.cwd();
const renamed = {};
let pendingChanges = 0;
let countLabels = {};

// Buffer errors so they do NOT print during progress
const errors = [];

async function saveLog() {
  await writeFile(LOG_PATH, JSON.stringify(renamed, null, 2));
  pendingChanges = 0;
}

function ellipsizeStart(str, max) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - (max - 1));
}

function firstLine(msg) {
  if (!msg) return '';
  return String(msg).split(/\r?\n/)[0];
}

/**
 * Decide concurrency:
 * - default: available CPU threads
 * - BUT clamp to terminal height so progress bars don't scroll/glitch
 * - override: UNIQUIFIER_JOBS or JOBS env var
 */
function resolveConcurrency(progressStream = process.stderr) {
  const cpuCount =
    (typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : (os.cpus()?.length || 1));

  const rows =
    progressStream && progressStream.isTTY && typeof progressStream.rows === 'number'
      ? progressStream.rows
      : 0;

  // We draw: N worker lines + 1 overall line (plus a little breathing room).
  // If rows is unknown (not a TTY), don’t clamp.
  const maxByRows = rows > 0 ? Math.max(1, rows - 4) : Number.POSITIVE_INFINITY;

  const env = process.env.UNIQUIFIER_JOBS || process.env.JOBS;
  const forced = env ? parseInt(env, 10) : NaN;

  const base = Number.isFinite(forced) && forced > 0 ? forced : cpuCount;

  // Clamp to avoid scrolling, which causes glitches on Windows terminals
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

  if (await isFile(workingPath)) {
    await prefixFile(workingPath);
    await saveLog();
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
    `Processing: ${workingPath} | workers=${CONCURRENCY} | cpus=${(typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : (os.cpus()?.length || 1))
    }`
  );

  const tasks = allFolders.map(folder =>
    limit(() =>
      prefixFilesByFolder(folder, {
        logLabel: path.relative(workingPath, folder) || path.basename(folder),
        progressManager,
      })
    )
  );

  await Promise.all(tasks);

  await saveLog();
  progressManager.stop();
  restoreConsoleError();

  // Pretty errors at bottom
  printErrorReport(errors, { maxList: 60 });

  console.log(
    `Total: ${Object.values(countLabels).reduce((acc, cur) => acc + cur, 0)}`
  );
  console.log(`Log File: ${LOG_PATH}`);
}

async function prefixFilesByFolder(folder, { logLabel, progressManager } = {}) {
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

    if (pendingChanges > 100) await saveLog();
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
