// Publishes the app to its permanent link (GitHub Pages).
// Saves everything to git, pushes the project to `main`, and pushes the app/ folder to `gh-pages`,
// which is what https://antoniomarketuae-design.github.io/dreaming-vta/ serves.
// Run after tools/bump.js:  node tools/publish.js
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' });

const v = require(path.join(ROOT, 'app', 'version.json'));
const note = v.notes[0]?.text ?? '';

git('add', '-A');
try {
  git('commit', '-m', `v${v.version}: ${note}`, '-m', 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>');
} catch {
  console.log('(nothing new to save)');
}
git('push', 'origin', 'main');
git('subtree', 'push', '--prefix', 'app', 'origin', 'gh-pages');

console.log(`\nPublished version ${v.version}. It is live in about a minute.`);
