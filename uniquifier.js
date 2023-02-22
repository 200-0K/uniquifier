/** script to rename files uniquely per folder (Recursively)**/
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ('rootDir' = folder) --contains--> ...folder(s) --contains--> file(s)a
const workingDir = process.cwd();

fs.readdirSync(workingDir).forEach(async folderName => {
    folderDir = path.resolve(workingDir, folderName);
    if (!fs.lstatSync(folderDir).isDirectory()) return;
    const randomCharacters = getRandomCharacters(5);
    const filenameCrypto = crypto.createHash("md5").update(folderName).digest("hex").slice(0, 6);
    const prefix = `[${randomCharacters}-${filenameCrypto}~]`;

    prefixFilesRecursively(folderDir, prefix);
})

function prefixFilesRecursively(folderDir, prefix) {
    console.log()
    fs.readdirSync(folderDir).forEach(fileName => {
        const fileDir = path.resolve(folderDir, fileName);
        if (fs.lstatSync(fileDir).isDirectory()) {
            prefixFilesRecursively(fileDir, prefix);
            return;
        }
        fs.renameSync(fileDir, path.resolve(folderDir, prefix+fileName));
        console.log(fileName, "-->", prefix+fileName);
    })
}

function getRandomHex() {
    return Number( Date.now() * Math.round((Math.random() * 10000) + (Math.random() * 100 + 1)) ).toString(16);
}

function getRandomCharacters(length) {
    let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let build = "";
    for (let i = 0; i < length; i++) 
        build += chars[Math.floor(Math.random() * chars.length)];
    return build;
}