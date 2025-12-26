/**
 * This script can rename files uniquely per folder (Recursively)
 */
const path = require('path');
const crypto = require('crypto');
const {
  fileExist,
  isFile,
  isDirectory,
  getFiles,
  writeFile,
  getFolders,
  renameFile,
} = require('./utils/FileManager');
const moment = require('moment/moment');

const LOG_PATH = path.resolve(
  __dirname,
  `storage/log/${moment().format('YYYY-MM-DD_HH-mm-ss')}~${getRandomHex()}.json`
);
const workingDir = process.cwd();
const renamed = {}
let pendingChanges = 0;

let countLabels = {};
console.count = label => {
  countLabels[label] = countLabels[label] ?? 0;
  countLabels[label]++;
  process.stdout.write(`${label}: ${countLabels[label]}\r`);
};

async function saveLog() {
  await writeFile(LOG_PATH, JSON.stringify(renamed, null, 2));
  pendingChanges = 0;
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
  } else if (await isDirectory(workingPath)) {
    console.log('Processing:', workingPath);
    const folders = await getFolders(workingPath);

    // Process root folder files
    await prefixFilesByFolder(workingPath);

    // Process subfolders
    for (const folder of folders) {
      await prefixFilesByFolder(folder, { logLabel: path.relative(workingPath, folder) });
    }

    await saveLog(); // Final save
    console.log(
      `Total: ${Object.values(countLabels).reduce((acc, cur) => acc + cur, 0)}`
    );
    console.log(`Log File: ${LOG_PATH}`);
  } else console.error(`Provide either a file path or a directory path`);
}

async function prefixFilesByFolder(folder, { logLabel } = {}) {
  const unique = getUniqueText(path.basename(folder));
  logLabel = logLabel ?? path.basename(folder)
  const files = await getFiles(folder, '*.*', false)

  // Process files in parallel for this folder
  await Promise.all(files.map(file => prefixFile(file, unique)));

  if (files.length > 0) {
    countLabels[`Processed From '${logLabel}'`] = (countLabels[`Processed From '${logLabel}'`] || 0) + files.length;
    console.log(`Processed From '${logLabel}': ${files.length}`);

    // Periodic log save every 100 files
    if (pendingChanges > 100) {
      await saveLog();
    }
  }
}

async function prefixFile(file, prefix = null) {
  prefix = prefix ?? getUniqueText(path.basename(path.dirname(file)));
  const renamePath = path.resolve(path.dirname(file), prefix + path.basename(file))

  const result = await renameFile(file, renamePath);
  if (result) {
    renamed[file] = renamePath;
    pendingChanges++;
  } else {
    console.error(`Error Renaming ${file} to ${renamePath}`);
  }
}

function getUniqueText(cryptoSuffix = null) {
  const randomCharacters = getRandomCharacters(5);
  let suffix = '';
  if (cryptoSuffix)
    suffix = `-${crypto
      .createHash('md5')
      .update(cryptoSuffix)
      .digest('hex')
      .slice(0, 6)}`;
  return `[${randomCharacters}${suffix}~]`;
}

function getRandomHex() {
  return Number(
    Date.now() * Math.round(Math.random() * 10000 + (Math.random() * 100 + 1))
  ).toString(16);
}

function getRandomCharacters(length) {
  let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let build = '';
  for (let i = 0; i < length; i++)
    build += chars[Math.floor(Math.random() * chars.length)];
  return build;
}
