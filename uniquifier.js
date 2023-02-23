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

let countLabels = {};
console.count = label => {
  countLabels[label] = countLabels[label] ?? 0;
  countLabels[label]++;
  process.stdout.write(`${label}: ${countLabels[label]}\r`);
};

main();
async function main() {
  if (!process.argv[2]) {
    console.error('You have to provide a location');
    return;
  }

  const workingPath = path.resolve(workingDir, process.argv[2]);
  if (!fileExist(process.argv[2])) {
    console.error('You have to provide a valid location');
    return;
  }

  if (isFile(workingPath)) {
    prefixFile(workingPath);
  } else if (isDirectory(workingPath)) {
    console.log('Processing:', workingPath);
    const folders = getFolders(workingPath);
    prefixFilesByFolder(workingPath);
    for (const folder of folders) {
      prefixFilesByFolder(folder, { logLabel: path.relative(workingPath, folder) });
    }
    console.log(
      `Total: ${Object.values(countLabels).reduce((acc, cur) => acc + cur, 0)}`
    );
    console.log(`Log File: ${LOG_PATH}`);
  } else console.error(`Provide either a file path or a directory path`);
}

function prefixFilesByFolder(folder, { logLabel } = {}) {
  const unique = getUniqueText(path.basename(path.dirname(folder)));
  logLabel = logLabel ?? path.basename(folder)
  for (const file of getFiles(folder, '*.*', false)) {
    prefixFile(file, unique);
    console.count(`Processed From '${logLabel}'`);
  }
  console.log();
}

function prefixFile(file, prefix = null) {
  prefix = prefix ?? getUniqueText(path.basename(path.dirname(file)));
  const renamePath = path.resolve(path.dirname(file), prefix+path.basename(file))

  if (renameFile(file, renamePath)) {
    renamed[file] = renamePath
    writeFile(LOG_PATH, JSON.stringify(renamed))
  } else console.error(`Error Renaming ${file} to ${renamePath}`)
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
