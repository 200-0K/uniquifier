const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const escapeGlob = require('glob-escape');
const fg = require('fast-glob');

async function fileExist(p) {
  try {
    await fs.access(p);
    return true;
  } catch (e) {
    return false;
  }
}

function fileExistSync(p) {
  return fsSync.existsSync(p);
}

/**
 *
 * @param {string} p path
 * @param {string} ext file extension to search for
 * @returns {Promise<Array<string>>} array of files with similar name but different extensions (e.g., a.txt, a.xmp, a.html, etc)
 */
async function similarFilesByName(p, ext = '*') {
  try {
    const pattern = `${escapeGlob(getFilePathWithoutExt(p).replace(/\\/g, '/'))}.${ext}`;
    const files = await fg(pattern, { onlyFiles: true, absolute: true });
    return files.filter(file => path.resolve(file) != path.resolve(p));
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function isFile(p) {
  try {
    const stats = await fs.lstat(p);
    return stats.isFile();
  } catch (e) {
    console.error(e);
    return null;
  }
}

function isFileSync(p) {
  try {
    return fsSync.lstatSync(p).isFile();
  } catch (e) {
    return null;
  }
}

async function isDirectory(p) {
  try {
    const stats = await fs.lstat(p);
    return stats.isDirectory();
  } catch (e) {
    console.error(e);
    return null;
  }
}

function isDirectorySync(p) {
  try {
    return fsSync.lstatSync(p).isDirectory();
  } catch (e) {
    return null;
  }
}

/**
 *
 * @param {string} p path
 * @returns file extension (e.g., .html, .txt, etc)
 */
function getFileExt(p) {
  return path.extname(p);
}

function getFilePathWithoutExt(p) {
  const { dir, name } = path.parse(p);
  return path.resolve(dir, name)
}

async function getFiles(p, pattern = '*.*', recurse = true) {
  const base = path.resolve(p).replace(/\\/g, '/');
  const globPattern = recurse
    ? `${escapeGlob(base)}/**/${pattern}`
    : `${escapeGlob(base)}/${pattern}`;

  return await fg(globPattern, { onlyFiles: true, absolute: true });
}

async function getFolders(p, pattern = '*', recurse = true) {
  const base = path.resolve(p).replace(/\\/g, '/');
  const globPattern = recurse
    ? `${escapeGlob(base)}/**/${pattern}`
    : `${escapeGlob(base)}/${pattern}`;

  return await fg(globPattern, { onlyDirectories: true, absolute: true });
}

async function readFile(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function writeFile(p, data) {
  try {
    await fs.writeFile(p, data, { encoding: 'utf8' })
    return true
  } catch (e) {
    console.error(e)
    return false
  }
}

async function appendFile(p, data, force = false) {
  const options = { encoding: 'utf8' }
  if (force) options.flag = 'a+'
  try {
    await fs.appendFile(p, data, options)
    return true
  } catch (e) {
    console.error(e)
    return false
  }
}

async function renameFile(oldPath, newPath) {
  if (oldPath === newPath) return;
  try {
    await fs.rename(oldPath, newPath);
    return newPath;
  } catch (e) {
    console.error(e);
    return null;
  }
}

module.exports = {
  fileExist,
  fileExistSync,
  similarFilesByName,
  getFilePathWithoutExt,
  isFile,
  isFileSync,
  isDirectory,
  isDirectorySync,
  getFileExt,
  getFiles,
  getFolders,
  readFile,
  writeFile,
  appendFile,
  renameFile,
};
