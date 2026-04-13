#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '../package.json');
const versionPath = path.join(__dirname, '../VERSION');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);

const type = process.argv[2] || 'patch';
let newVersion;
if (type === 'major') newVersion = `${major + 1}.0.0`;
else if (type === 'minor') newVersion = `${major}.${minor + 1}.0`;
else newVersion = `${major}.${minor}.${patch + 1}`;

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(versionPath, newVersion + '\n');

console.log(`Version bumped to ${newVersion}`);

// Stage the changed files for commit
const { execSync } = require('child_process');
execSync('git add package.json VERSION');
