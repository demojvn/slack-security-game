/**
 * Fetches the two Slack help articles used as source material for the game,
 * hashes their content, and compares against the last known hash.
 * If anything changed, writes a markdown report and signals the workflow.
 */

import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { load } from 'cheerio';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';

const SOURCES = [
  {
    name: 'Best practices for Slack security',
    url: 'https://slack.com/help/articles/115004155306-Best-practices-for-Slack-security',
    selector: 'article, main, .p-rich_text_section, .doc_content'
  },
  {
    name: 'Permissions in a Slack workspace',
    url: 'https://slack.com/help/articles/201314026-Permissions-in-a-Slack-workspace',
    selector: 'article, main, .p-rich_text_section, .doc_content'
  },
  {
    name: 'Slack Release Notes',
    url: 'https://slack.com/release-notes/mac',
    selector: 'article, main, .release_notes, .doc_content'
  },
  {
    name: 'Slack Developer Changelog',
    url: 'https://docs.slack.dev/changelog',
    selector: 'article, main, .changelog, .doc_content'
  }
];

const HASHES_FILE = 'content-hashes.json';

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function fetchText(url, selector) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; slack-security-game-update-checker/1.0)'
    }
  });
  if (!res.ok) return `HTTP_ERROR_${res.status}`;
  const html = await res.text();
  const $ = load(html);
  // Try to grab the main article content; fall back to full body text
  const content = $(selector).text().trim() || $('body').text().trim();
  // Normalise whitespace so minor formatting tweaks don't trigger false positives
  return content.replace(/\s+/g, ' ');
}

async function main() {
  const previousHashes = existsSync(HASHES_FILE)
    ? JSON.parse(readFileSync(HASHES_FILE, 'utf8'))
    : {};

  const newHashes = {};
  const changes = [];

  for (const source of SOURCES) {
    console.log(`Fetching: ${source.url}`);
    const text = await fetchText(source.url, source.selector);
    const newHash = hash(text);
    const oldHash = previousHashes[source.url] || null;

    newHashes[source.url] = newHash;

    if (oldHash && oldHash !== newHash) {
      changes.push({
        name: source.name,
        url: source.url,
        previousHash: oldHash,
        newHash
      });
      console.log(`CHANGED: ${source.name}`);
    } else if (!oldHash) {
      console.log(`FIRST RUN (no baseline yet): ${source.name}`);
    } else {
      console.log(`No change: ${source.name}`);
    }
  }

  // Save updated hashes for next run
  writeFileSync(HASHES_FILE, JSON.stringify(newHashes, null, 2));

  if (changes.length === 0) {
    console.log('No changes detected.');
    writeOutput('false');
    return;
  }

  // Build a markdown report for the GitHub issue
  const date = new Date().toISOString().split('T')[0];
  const lines = [
    `## Slack Help Content Changes Detected — ${date}`,
    '',
    'The weekly content check found differences in one or more source articles.',
    'Please review the articles below and update the flashcard answers in `index.html` and `android.html` as needed.',
    '',
    '---',
    ''
  ];

  for (const c of changes) {
    lines.push(`### 📄 ${c.name}`);
    lines.push(`**URL:** [${c.url}](${c.url})`);
    lines.push('');
    lines.push('**What to do:**');
    lines.push(`1. Open the URL above and read through the article`);
    lines.push(`2. Compare with the current flashcard answers in \`index.html\``);
    lines.push(`3. Update any answers that are no longer accurate`);
    lines.push(`4. Commit and push — the site will redeploy automatically`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('> This issue was created automatically by the weekly content check workflow.');
  lines.push('> Close it once you have reviewed and updated the game content.');

  writeFileSync('changes-report.md', lines.join('\n'));
  console.log(`Changes detected in ${changes.length} source(s). Report written.`);
  writeOutput('true');
}

function writeOutput(value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `changes_detected=${value}\n`);
  } else {
    console.log(`changes_detected=${value}`);
  }
}

main().catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});
