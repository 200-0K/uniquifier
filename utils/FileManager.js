const fs = require('fs');
const path = require('path');
const escapeGlob = require('glob-escape');
const glob = require('glob');

function fileExist(p) {
  try {
    return fs.existsSync(p);
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 *
 * @param {string} p path
 * @param {string} ext file extension to search for
 * @returns {Array<string>} array of files with similar name but different extensions (e.g., a.txt, a.xmp, a.html, etc)
 */
function similarFilesByName(p, ext = '*') {
  try {
    const similarFiles = glob
    .sync(`${escapeGlob(getFilePathWithoutExt(p).replace(/\\/g, '/'))}.${ext}`, {
      nodir: true
    })
    .filter(file => path.resolve(file) != path.resolve(p));
    return similarFiles;
  } catch (e) {
    console.error(e);
    return null;
  }
}

function isFile(p) {
  try {
    return fs.lstatSync(p).isFile();
  } catch (e) {
    console.error(e);
    return null;
  }
}

function isDirectory(p) {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch (e) {
    console.error(e);
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

function getFiles(p, pattern = '*.*', recurse = true) {
  let resolveArgs = [escapeGlob( path.resolve(p).replace(/\\/g, '/') )]
  if (recurse) resolveArgs.push('**')
  resolveArgs.push(pattern)
  return glob.sync(resolveArgs.join('/'), {
    nodir: true
  });
}

function getFolders(p, pattern = '*', recurse = true) {
  let resolveArgs = [escapeGlob( path.resolve(p).replace(/\\/g, '/') )]
  if (recurse) resolveArgs.push('**')
  resolveArgs.push(pattern)
  resolveArgs.push('') // to add '/' at the end when joining
  return glob.sync(resolveArgs.join('/'));
}

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf8').toString();
  } catch (e) {
    console.error(e);
    return null;
  }
}

function writeFile(p, data) {
  try {
    fs.writeFileSync(p, data, { encoding: 'utf8' })
    return true
  } catch (e) {
    console.error(e)
    return false
  }
}

function appendFile(p, data, force = false) {
  const options = { encoding: 'utf8' }
  if (force) options.flag = 'a+'
  try {
    fs.appendFileSync(p, data, options)
    return true
  } catch (e) {
    console.error(e)
    return false
  }
}

function renameFile(oldPath, newPath) {
  if (oldPath === newPath) return;
  try {
    fs.renameSync(oldPath, newPath);
    return newPath;
  } catch (e) {
    console.error(e);
    return null;
  }
}

module.exports = {
  fileExist,
  similarFilesByName,
  getFilePathWithoutExt,
  isFile,
  isDirectory,
  getFileExt,
  getFiles,
  getFolders,
  readFile,
  writeFile,
  appendFile,
  renameFile,
};
