// tests/settlement.test.mjs — ledger is hash-chained and refuses PII.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('log settlement chains hashes and blocks PII fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-'));
  process.env.APEXFORGE_ROOT = dir;
  const { getSettlement } = await import('../lib/settlement.mjs?' + Date.now());
  const s = await getSettlement('log');
  const leadHash = 'a'.repeat(64);
  const r1 = await s.record({ type: 'created', leadHash, vertical: 'life-insurance', tier: 'A' });
  const r2 = await s.record({ type: 'sold', leadHash, buyer: 'B-0007', priceCents: 6500 });
  const lines = fs.readFileSync(path.join(dir, 'data', 'ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines[1].prev, r1.ref);
  assert.equal(lines[1].hash, r2.ref);
  await assert.rejects(s.record({ type: 'sold', leadHash, phone: '+15125552368' }), /PII guard/);
});
