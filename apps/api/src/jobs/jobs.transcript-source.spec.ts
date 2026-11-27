import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { validateSync } from 'class-validator';

import { loadSource } from '../testing/load-source.ts';

const resolve = createRequire(import.meta.url).resolve;
const { CreateJobDto } = loadSource<typeof import('./dto/create-job.dto')>(resolve('./dto/create-job.dto.ts'));
const { CreatePreviewDto } = loadSource<typeof import('../previews/dto/create-preview.dto')>(resolve('../previews/dto/create-preview.dto.ts'));
const { JobsService } = loadSource<typeof import('./jobs.service')>(resolve('./jobs.service.ts'));
const { PreviewsService } = loadSource<typeof import('../previews/previews.service')>(resolve('../previews/previews.service.ts'));
const { QueueListener } = loadSource<typeof import('../queue/queue.listener')>(resolve('../queue/queue.listener.ts'));
const { LlmStatusService } = loadSource<typeof import('../system/llm-status.service')>(resolve('../system/llm-status.service.ts'));

const { MediaResolverService } = loadSource<typeof import('../media/media-resolver.service')>(resolve('../media/media-resolver.service.ts'));
const mediaResolver = new MediaResolverService(...[{}, {}] as unknown as ConstructorParameters<typeof MediaResolverService>);

const url = 'https://www.youtube.com/watch?v=example';
const userId = 'user-1';
const cases = [
  [undefined, 'youtube'],
  ['youtube', 'youtube'],
  ['auto', 'auto'],
  ['live_chat_stt', 'live_chat_stt'],
] as const;

function sourceInput(transcriptSource: string | undefined) {
  return transcriptSource === undefined ? {} : { transcriptSource };
}

for (const Dto of [CreateJobDto, CreatePreviewDto]) {
  test(`${Dto.name} validates optional transcriptSource and rejects unknown values`, () => {
    const input = Dto === CreateJobDto ? { url, mode: 'auto' } : { url };
    for (const [source] of cases) {
      const dto = Object.assign(new Dto(), input, sourceInput(source));
      assert.deepEqual(validateSync(dto, { whitelist: true }), []);
    }
    const invalid = Object.assign(new Dto(), input, { transcriptSource: 'unknown' });
    const errors = validateSync(invalid, { whitelist: true });
    assert.deepEqual(errors.map(({ property }) => property), ['transcriptSource']);
    assert.ok(errors[0].constraints?.isIn);
  });
}

for (const [source, expected] of cases) {
  test(`JobsService persists and queues transcriptSource=${source} on create and retry`, async () => {
    const persisted: unknown[] = [];
    const queued: unknown[] = [];
    const oldJob = { url, mode: 'auto', status: 'failed', clips: [], ...sourceInput(source) };
    const prisma = { job: {
      create: async ({ data }: { data: { transcriptSource: string } }) => {
        persisted.push(data.transcriptSource);
        return { id: 'job-1', ...data };
      },
      findUnique: async () => oldJob,
    } };
    const queue = { add: async (_name: string, data: { transcriptSource: string }) => {
      queued.push(data.transcriptSource);
    } };
    const deps = [prisma, {}, {}, { resolveSettings: async () => [] },
      { resolveSettings: async () => null }, {}, queue, mediaResolver];
    const service = new JobsService(...deps as unknown as ConstructorParameters<typeof JobsService>);
    const dto = Object.assign(new CreateJobDto(), { url, mode: 'auto' as const },
      source === undefined ? {} : { transcriptSource: source });

    assert.equal((await service.create(dto, userId)).transcriptSource, expected);
    assert.equal((await service.retry('old-job', userId)).transcriptSource, expected);
    assert.deepEqual(persisted, [expected, expected]);
    assert.deepEqual(queued, [expected, expected]);
    assert.equal((await service.snapshot('old-job', userId)).transcriptSource, expected);
  });

  test(`PreviewsService queues and returns transcriptSource=${source}`, async () => {
    let data: { url: string; userId: string; transcriptSource?: string };
    const queue = {
      add: async (_name: string, payload: typeof data) => { data = payload; },
      getJob: async () => ({ data, getState: async () => 'waiting' }),
    };
    const service = new PreviewsService(queue as unknown as ConstructorParameters<typeof PreviewsService>[0], mediaResolver);
    const dto = Object.assign(new CreatePreviewDto(), { url },
      source === undefined ? {} : { transcriptSource: source });

    const { id } = await service.create(dto, userId);
    assert.equal(data!.transcriptSource, expected);
    assert.equal((await service.findOne(id, userId)).transcriptSource, expected);
    data = { url, userId, ...sourceInput(source) };
    assert.equal((await service.findOne(id, userId)).transcriptSource, expected);
  });
}

test('QueueListener emits transcriptSource in job snapshots', async () => {
  const emitted: unknown[] = [];
  let job: { clips: []; transcriptSource?: string } = { clips: [] };
  const prisma = { job: { findUnique: async () => job } };
  const deps = [{}, {}, prisma, {
    publish: (snapshot: { transcriptSource: string }) => emitted.push(snapshot.transcriptSource),
  }];
  const listener = new QueueListener(...deps as unknown as ConstructorParameters<typeof QueueListener>);
  const emit = listener as unknown as { emit(jobId: string): Promise<void> };
  for (const [source] of cases) {
    job = { clips: [], ...sourceInput(source) };
    await emit.emit('job-1');
  }
  assert.deepEqual(emitted, cases.map(([, expected]) => expected));
});

test('LlmStatusService preserves typed STT fields and omits absent or malformed fields', async () => {
  let raw: string | null = null;
  const queue = { client: Promise.resolve({ get: async () => raw }) };
  const service = new LlmStatusService(queue as unknown as ConstructorParameters<typeof LlmStatusService>[0]);
  assert.equal((await service.get()).workerOnline, false);
  for (const payload of [{}, { sttConfigured: 'false', sttModel: 123 }]) {
    raw = JSON.stringify(payload);
    const status = await service.get();
    assert.equal(status.workerOnline, true);
    assert.equal('sttConfigured' in status, false);
    assert.equal('sttModel' in status, false);
  }
  for (const payload of [{ sttConfigured: true, sttModel: 'speech-model' }, { sttConfigured: false, sttModel: null }]) {
    raw = JSON.stringify(payload);
    const { sttConfigured, sttModel } = await service.get();
    assert.deepEqual({ sttConfigured, sttModel }, payload);
  }
});
