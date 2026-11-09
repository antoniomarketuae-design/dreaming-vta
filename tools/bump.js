// Records a new version of the app so phones pick it up and the Build log shows it.
// Run after every change:  node tools/bump.js "What changed, in plain words"
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'app', 'version.json');
const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error('Usage: node tools/bump.js "What changed"');
  process.exit(1);
}

const v = JSON.parse(fs.readFileSync(file, 'utf8'));
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

v.version += 1;
v.updated = today;
v.notes.unshift({ version: v.version, date: today, text });

fs.writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);
console.log(`Dreaming is now at version ${v.version}`);
