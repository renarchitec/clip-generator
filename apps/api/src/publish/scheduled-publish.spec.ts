import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import * as clipSocial from '../queue/clip-social.ts';
import * as instagramHelpers from './instagram-helpers.ts';
import * as publishHelpers from './publish-helpers.ts';
import type { PublishService as Service } from './publish.service';

// Match the API suite's strip-types runner while exercising the real Nest service.
const file = fileURLToPath(new URL('./publish.service.ts', import.meta.url));
const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true,
  },
});
const require = createRequire(file);
const dependencies: Record<string, unknown> = {
  '../queue/clip-social': clipSocial,
  '../queue/queue.constants': { PUBLISH_QUEUE_NAME: 'publish' },
  './publish-helpers': publishHelpers,
  './instagram-helpers': instagramHelpers,
};
const exports = {} as typeof import('./publish.service');
runInThisContext(`(function (exports, require) { ${outputText}\n})`, { filename: file })(
  exports, (id: string) => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id),
);
const { PublishService, publishJobId } = exports;

function service(prisma: object, queue: object) {
  return new PublishService(
    prisma as ConstructorParameters<typeof Service>[0],
    queue as ConstructorParameters<typeof Service>[1],
  );
}

const start = new Date('2026-06-01T12:00:00Z');
const timestampFields = { createdAt: start, updatedAt: start };

test('cancel claims an owned queued or scheduled row before best-effort queue removal', async () => {
  const actions: string[] = [];
  const owner = { id: 'pub', clip: { job: { userId: 'owner' } } };
  const api = service({ publication: {
    findFirst: async ({ where }) => {
      assert.deepEqual(where, owner);
      return { status: 'scheduled' };
    },
    updateMany: async ({ where, data }) => {
      assert.deepEqual(where, { ...owner, status: { in: ['scheduled', 'queued'] } });
      assert.deepEqual(data, { status: 'cancelled', error: null });
      actions.push('cancelled');
      return { count: 1 };
    },
    findUnique: async () => ({ ...timestampFields, status: 'cancelled', error: null, scheduledAt: start }),
  } }, { remove: async (id) => {
    assert.equal(id, publishJobId('pub'));
    actions.push('removed');
    throw new Error('job locked');
  } });
  const response = await api.cancel('pub', 'owner');
  assert.deepEqual(actions, ['cancelled', 'removed']);
  assert.equal(response.status, 'cancelled');
  assert.equal(response.scheduledAt, start.toISOString());
});

test('cancel rejects foreign, ineligible, and just-claimed uploads without removing a job', async () => {
  for (const [status, expected] of [[null, 404], ['uploading', 400], ['queued', 400]] as const) {
    let updates = 0;
    let removals = 0;
    const api = service({ publication: {
      findFirst: async () => status && { status },
      updateMany: async () => { updates++; return { count: 0 }; },
    } }, { remove: async () => { removals++; } });
    await assert.rejects(api.cancel('pub', 'owner'), { status: expected });
    assert.equal(updates, status === 'queued' ? 1 : 0);
    assert.equal(removals, 0);
  }
});

test('retrying a cancelled publication clears its schedule and promotes a leftover delayed job', async () => {
  let reset: Record<string, unknown>;
  let promoted = false;
  const api = service({ publication: {
    findFirst: async ({ where }) => where.id === 'pub'
      ? { id: 'pub', clipId: 'clip', socialAccountId: 'yt', status: 'cancelled', clip: {} }
      : null,
    updateMany: async ({ where, data }) => {
      assert.deepEqual(where, { id: 'pub', status: 'cancelled' });
      reset = data;
      return { count: 1 };
    },
    findUnique: async () => ({ ...timestampFields, ...reset }),
  } }, { getJob: async () => ({ getState: async () => 'delayed', promote: async () => { promoted = true; } }) });
  const response = await api.retry('pub', 'owner');
  assert.equal(promoted, true);
  assert.equal(response.status, 'queued');
  assert.equal(response.scheduledAt, null);
  assert.equal(response.progress, 0);
  assert.equal(response.error, null);
});

test('batch respects clip order, spaces slots, skips active/published pairs and uses platform captions with fallback', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const clips = [
    { id: 'best', title: '<Generic title>', caption: 'Generic #shared', hashtags: ['shared', 'extra'] },
    { id: 'second', title: 'Other', caption: 'Old', hashtags: ['old'], platformCaptions: {
      youtube: { title: 'Specific title', caption: 'Specific caption', hashtags: ['new'] },
      tiktok: { caption: 'a'.repeat(2300), hashtags: [] },
    } },
  ];
  const accounts = [
    { id: 'yt', platform: 'youtube', displayName: 'YouTube', externalId: 'yt-channel' },
    { id: 'tt', platform: 'tiktok', displayName: 'TikTok', externalId: 'tt-channel' },
  ];
  const created = new Map();
  const enqueued = [];
  const prisma = {
    job: { findFirst: async ({ where, select }) => {
      assert.deepEqual(where, { id: 'job', userId: 'owner' });
      assert.deepEqual(select.clips.where, { deletedAt: null, id: { in: ['second', 'best'] } });
      assert.deepEqual(select.clips.orderBy, [{ viralScore: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }]);
      return { clips };
    } },
    socialAccount: { findMany: async ({ where }) => {
      assert.deepEqual(where, { userId: 'owner', id: { in: ['yt', 'tt'] } });
      return accounts;
    } },
    publication: {
      findMany: async ({ where }) => {
        assert.deepEqual(where.status.in, ['scheduled', 'queued', 'uploading', 'processing', 'published']);
        return [{ clipId: 'best', socialAccountId: 'tt' }];
      },
      create: async ({ data }) => {
        const row = { ...timestampFields, ...data, id: `p${created.size + 1}` };
        created.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }) => created.get(where.id),
    },
    $transaction: async (fn) => fn(prisma),
  };
  const api = service(prisma, {
    getJob: async () => null,
    add: async (name, data, options) => enqueued.push([name, data.publicationId, options.delay]),
  });
  const { scheduled, skipped } = await api.batchSchedule('job', {
    clipIds: ['second', 'best'], accountIds: ['yt', 'tt'], intervalHours: 0.5,
  }, 'owner');

  assert.deepEqual(skipped, [{ clipId: 'best', accountId: 'tt', reason: 'already_published_or_scheduled' }]);
  assert.deepEqual(scheduled.map(({ clipId, accountId, status, scheduledAt }) => [clipId, accountId, status, scheduledAt]), [
    ['second', 'yt', 'queued', null],
    ['second', 'tt', 'queued', null],
    ['best', 'yt', 'scheduled', new Date(start.getTime() + 1_800_000).toISOString()],
  ]);
  assert.equal(scheduled[0].title, 'Specific title');
  assert.equal(scheduled[0].caption, 'Specific caption\n\n#new');
  assert.equal(scheduled[1].caption.length, 2200);
  assert.equal(scheduled[1].mode, 'inbox');
  assert.equal(scheduled[2].title, 'Generic title');
  assert.equal(scheduled[2].caption, 'Generic #shared\n\n#extra');
  assert.deepEqual(enqueued, [['upload', 'p1', undefined], ['upload', 'p2', undefined], ['upload', 'p3', 1_800_000]]);
});

test('single-clip publish applies target schedules before the request default', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const defaultAt = new Date(start.getTime() + 120_000).toISOString();
  const targetAt = new Date(start.getTime() + 60_000).toISOString();
  const accounts = ['default', 'override', 'immediate'].map((id) => ({ id, platform: 'youtube' }));
  const rows = [];
  const delays = [];
  const prisma = {
    clip: { findFirst: async () => ({ id: 'clip' }) },
    socialAccount: { findMany: async () => accounts },
    publication: {
      findFirst: async () => null,
      create: async ({ data }) => {
        const row = { ...data, ...timestampFields, id: data.socialAccountId };
        rows.push(row);
        return row;
      },
      findMany: async () => rows,
    },
    $transaction: async (fn) => fn(prisma),
  };
  const api = service(prisma, {
    getJob: async () => null,
    add: async (_name, _data, options) => delays.push(options.delay),
  });
  const target = { title: 'Clip', caption: '', privacy: 'public' } as const;
  const pubs = await api.publish('clip', {
    scheduledAt: defaultAt,
    targets: [
      { ...target, accountId: 'default' },
      { ...target, accountId: 'override', scheduledAt: targetAt },
      { ...target, accountId: 'immediate', scheduledAt: start.toISOString() },
    ],
  }, 'owner');
  assert.deepEqual(pubs.map(({ status, scheduledAt }) => [status, scheduledAt]), [
    ['scheduled', defaultAt], ['scheduled', targetAt], ['queued', null],
  ]);
  assert.deepEqual(delays, [120_000, 60_000, undefined]);
});

test('batch rejects invalid TikTok direct options before creating publications', async () => {
  const api = service({
    job: { findFirst: async () => ({ clips: [] }) },
    socialAccount: { findMany: async () => [{ id: 'tt', platform: 'tiktok' }] },
  }, {});
  await assert.rejects(api.batchSchedule('job', { accountIds: ['tt'], intervalHours: 1, tiktokMode: 'direct' }, 'owner'), {
    status: 400,
    message: 'tiktok wajib diisi untuk mode direct.',
  });
});
