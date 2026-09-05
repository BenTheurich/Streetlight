import assert from 'node:assert/strict';
import test from 'node:test';
import type { FinalizedBatch } from './packet-finalization.ts';
import { createPacketPreparation } from './packet-preparation.ts';

const proposal = {
  targetHomes: 30,
  estimatedHomes: 30,
  coverageClass: 'red' as const,
  segments: [
    {
      id: 'segment-a',
      estimatedHomes: 30,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0],
          [0, 0.01],
        ] as [number, number][],
      },
    },
  ],
  start: { address: '1 Main Street', position: [0, 0] as [number, number] },
  streetNames: ['Main Street'],
};
const proposals = {
  proposals: [proposal],
  warnings: [],
  proposalFingerprint: 'a'.repeat(64),
  proposalIndexes: [0],
};
const batch: FinalizedBatch = {
  id: 'batch-a',
  name: 'Batch A',
  finalizedAt: '2026-09-05T00:00:00Z',
  packetCount: 1,
  estimatedHomes: 30,
  packets: [{ ...proposal, id: 'packet-a', code: 'A-001' }],
};

function setup(request: typeof fetch, refresh = async (_batch: FinalizedBatch) => {}) {
  const published: unknown[] = [];
  const saved: Blob[] = [];
  const workflow = createPacketPreparation({
    initialResult: proposals,
    request,
    refresh,
    onResult: (value) => published.push(value),
    clearSelection: () => {},
    savePdf: (blob) => {
      saved.push(blob);
    },
  });
  return { workflow, published, saved };
}

test('finalization, refresh failure, failed PDF and retry preserve the finalized batch identity', async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  let pdfFails = true;
  const { workflow, saved } = setup(
    async (url, init) => {
      urls.push(String(url));
      if (String(url) === '/api/batches/finalize') {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json(batch);
      }
      if (pdfFails)
        return Response.json({ error: 'Could not render packet maps' }, { status: 502 });
      return new Response('pdf', { headers: { 'content-type': 'application/pdf' } });
    },
    async () => {
      throw new Error('Coverage refresh failed');
    },
  );
  workflow.setName('  Sunday  ');
  await workflow.finalize();
  assert.deepEqual(bodies, [
    {
      requests: [{ quantity: 1, targetHomes: 30 }],
      proposalFingerprint: proposals.proposalFingerprint,
      proposalIndexes: [0],
      customName: 'Sunday',
    },
  ]);
  assert.equal(workflow.getSnapshot().finalized?.id, 'batch-a');
  assert.match(workflow.getSnapshot().feedback?.detail ?? '', /Reload the page to refresh/);
  assert.deepEqual(workflow.getSnapshot().feedback?.retryTarget, { batchId: 'batch-a' });
  pdfFails = false;
  await workflow.retryDownload();
  assert.deepEqual(urls, [
    '/api/batches/finalize',
    '/api/packets/pdf?scope=batch&batchId=batch-a',
    '/api/packets/pdf?scope=batch&batchId=batch-a',
  ]);
  assert.equal(saved.length, 1);
  assert.match(workflow.getSnapshot().feedback?.detail ?? '', /Reload the page to refresh/);
  await workflow.download('newest');
  await workflow.download('active');
  assert.deepEqual(urls.slice(-2), [
    '/api/packets/pdf?scope=newest',
    '/api/packets/pdf?scope=active',
  ]);
});

test('uncertain finalization locks every later request and preserves reviewed proposals', async () => {
  let requests = 0;
  const { workflow } = setup(async () => {
    requests += 1;
    throw new Error('Connection lost');
  });
  await workflow.finalize();
  assert.equal(workflow.getSnapshot().operation?.kind, 'uncertain');
  workflow.receiveResult(null);
  workflow.updateRow(0, 'quantity', '3');
  workflow.addRow();
  workflow.deleteProposal(0);
  await workflow.generate();
  await workflow.finalize();
  await workflow.download('newest');
  assert.equal(requests, 1);
  assert.equal(workflow.getSnapshot().result, proposals);
  assert.equal(workflow.getSnapshot().rows[0].quantity, '1');
});

test('the workflow locks synchronously throughout finalization, refresh and PDF preparation', async () => {
  let finishRefresh = () => {};
  const refresh = new Promise<void>((resolve) => {
    finishRefresh = resolve;
  });
  const urls: string[] = [];
  const { workflow } = setup(
    async (url) => {
      urls.push(String(url));
      return String(url).endsWith('/finalize') ? Response.json(batch) : new Response('pdf');
    },
    () => refresh,
  );
  const operation = workflow.finalize();
  await workflow.finalize();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workflow.getSnapshot().operation?.kind, 'refreshing');
  await workflow.generate();
  await workflow.download('active');
  assert.deepEqual(urls, ['/api/batches/finalize']);
  finishRefresh();
  await operation;
  assert.equal(workflow.getSnapshot().operation, null);
  assert.equal(urls.length, 2);
});

test('generation rejects malformed responses, retains review on failure, and invalidates it on edit', async () => {
  const { workflow, published } = setup(async () => Response.json({ proposals: [{}] }));
  await workflow.generate();
  assert.equal(workflow.getSnapshot().result, proposals);
  assert.equal(workflow.getSnapshot().feedback?.tone, 'error');
  workflow.updateRow(0, 'quantity', '2');
  assert.equal(workflow.getSnapshot().result, null);
  assert.equal(published.at(-1), null);
});

test('a rejected finalization can regenerate and selection indexes remain the reviewed identities', async () => {
  const { workflow } = setup(async (url) =>
    String(url).endsWith('/finalize')
      ? Response.json({ error: 'Generate proposals again' }, { status: 409 })
      : Response.json({ ...proposals, proposals: [proposal, proposal], proposalIndexes: [0, 1] }),
  );
  await workflow.finalize();
  assert.equal(workflow.getSnapshot().operation, null);
  assert.equal(workflow.getSnapshot().feedback?.requiresRegeneration, true);
  await workflow.generate();
  workflow.deleteProposal(0);
  assert.deepEqual(workflow.getSnapshot().result?.proposalIndexes, [1]);
});

test('parent proposal echoes preserve the review and region changes retain saved PDF recovery', async () => {
  const { workflow } = setup(async (url) =>
    String(url).endsWith('/finalize')
      ? Response.json(batch)
      : Response.json({ error: 'Could not render packet maps' }, { status: 502 }),
  );
  workflow.confirm(true);
  const review = workflow.getSnapshot();
  workflow.receiveResult(proposals);
  assert.equal(workflow.getSnapshot(), review);
  await workflow.finalize();
  workflow.receiveResult(null);
  assert.equal(workflow.getSnapshot().result, null);
  assert.equal(workflow.getSnapshot().finalized?.id, batch.id);
  assert.deepEqual(workflow.getSnapshot().feedback?.retryTarget, { batchId: batch.id });
});
