// Talks to the Dreaming interpretation inbox on the server, using the admin key kept on this PC.
//   node tools/inbox.mjs wait [seconds]      poll until at least one dream is waiting, print them, exit
//   node tools/inbox.mjs queue               dreams waiting now
//   node tools/inbox.mjs claim <id>          mark as being interpreted
//   node tools/inbox.mjs answer <id> <file>  send the result JSON (checked against the knowledge base first)
//   node tools/inbox.mjs fail <id> "<why>"   give up on a dream
//   node tools/inbox.mjs release <id>        put a claimed dream back in the queue
//   node tools/inbox.mjs recent [n]          latest dreams with answers, ratings and feedback
//   node tools/inbox.mjs stats
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadKb, checkResult as checkAgainstKb } from './kb.mjs';

const BASE = process.env.DREAMING_API || 'https://nexflowclub.com/dreaming-api';
const KEY = readFileSync(join(homedir(), '.dreaming', 'admin.key'), 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error || ''}`);
  return data;
}

const checkResult = (result) => checkAgainstKb(result, loadKb().entries);

const [cmd, ...args] = process.argv.slice(2);
const print = (v) => console.log(JSON.stringify(v, null, 2));

try {
  if (cmd === 'wait') {
    const every = (Number(args[0]) || 20) * 1000;
    for (;;) {
      try {
        const { items } = await api('GET', '/admin/queue');
        if (items.length) { print(items); break; }
      } catch (err) {
        console.error(new Date().toISOString(), err.message);
      }
      await sleep(every);
    }
  } else if (cmd === 'queue') {
    print((await api('GET', '/admin/queue')).items);
  } else if (cmd === 'claim' || cmd === 'release') {
    print(await api('POST', `/admin/interpretations/${args[0]}/${cmd}`));
  } else if (cmd === 'answer') {
    const result = JSON.parse(readFileSync(args[1], 'utf8'));
    const problems = checkResult(result);
    if (problems.length && !args.includes('--force')) {
      console.error('Not sent. Problems:\n- ' + problems.join('\n- '));
      process.exit(2);
    }
    print(await api('POST', `/admin/interpretations/${args[0]}/answer`, { result }));
  } else if (cmd === 'fail') {
    print(await api('POST', `/admin/interpretations/${args[0]}/fail`, { error: args.slice(1).join(' ') || 'failed' }));
  } else if (cmd === 'recent') {
    print((await api('GET', `/admin/recent?limit=${Number(args[0]) || 10}`)).items);
  } else if (cmd === 'stats') {
    print(await api('GET', '/admin/stats'));
  } else {
    console.error('Usage: node tools/inbox.mjs wait [seconds] | queue | claim <id> | answer <id> <file> | fail <id> "<why>" | release <id> | recent [n] | stats');
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
