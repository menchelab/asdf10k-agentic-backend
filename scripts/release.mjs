#!/usr/bin/env node
// Release the backend: checks, version bump, CHANGELOG.md with every commit, commit, tag vX.Y.Z,
// push, GitHub release with that version's changelog section.
// Usage: npm run release -- [patch|minor|major] [--no-push]   (default: minor)
// Pushing uses the GitHub CLI login over HTTPS (gh auth login && gh auth setup-git); nothing prompts.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const bump = args.find((a) => ['patch', 'minor', 'major'].includes(a)) ?? 'minor';
const push = !args.includes('--no-push');
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
const git = (...a) => run('git', a).trim();
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (git('status', '--porcelain')) fail('Commit your changes first.');
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('Release from main.');

console.log('typecheck + tests ...');
run('npm', ['run', 'typecheck'], { inherit: true });
run('npm', ['test'], { inherit: true });

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const version = bump === 'major' ? `${ma + 1}.0.0` : bump === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
const tag = `v${version}`;
if (git('tag', '--list', tag)) fail(`${tag} exists already.`);

// CHANGELOG: every commit per release tag (vX.Y.Z), newest first; the new version gets everything since the last one
const tags = git('tag', '--sort=creatordate', '--list', 'v*').split('\n').filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
const ranges = tags.map((t, i) => ({ version: t.slice(1), range: i === 0 ? t : `${tags[i - 1]}..${t}`, date: git('log', '-1', '--format=%cs', t) }));
ranges.push({ version, range: tags.length ? `${tags.at(-1)}..HEAD` : 'HEAD', date: new Date().toISOString().slice(0, 10) });
const section = ({ version: v, range, date }) => {
  const lines = git('log', '--no-merges', '--format=- %s (%h)', range).split('\n').filter((l) => l && !/^- chore(\(.+\))?: release v/.test(l));
  return `## ${v} (${date})\n\n${lines.length} commits.\n\n${lines.join('\n')}`;
};
const sections = ranges.reverse().map(section);
writeFileSync('CHANGELOG.md', `# Changelog\n\nEvery commit of every release, newest first.\n\n${sections.join('\n\n')}\n`);

pkg.version = version;
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md');
git('commit', '-m', `chore: release ${tag}`);
git('tag', '-a', tag, '-m', `asdf10k-agentic-backend ${tag}`);
console.log(`Released ${tag} locally.`);

if (!push) {
  console.log(`Not pushed (--no-push). Push: git push origin main ${tag} && gh release create ${tag} --title ${tag} --notes-file <section>`);
  process.exit(0);
}
run('git', ['push', 'origin', 'main', tag], { inherit: true });
const notes = sections[0].split('\n').slice(2).join('\n');
writeFileSync('.release-notes.tmp.md', notes);
try {
  run('gh', ['release', 'create', tag, '--title', `asdf10k-agentic-backend ${tag}`, '--notes-file', '.release-notes.tmp.md'], { inherit: true });
} finally {
  run('rm', ['-f', '.release-notes.tmp.md']);
}
console.log(`Pushed ${tag} and created the GitHub release.`);
