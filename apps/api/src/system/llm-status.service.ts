import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAME } from '../queue/queue.constants';
import { LLM_STATUS_KEY } from './llm-status.constants';

export interface LlmLastCall {
  ok: boolean;
  at: string;
  error?: string;
}

export interface LlmStatus {
  workerOnline: boolean;
  configured: boolean;
  model: string | null;
  sttConfigured?: boolean;
  sttModel?: string | null;
  lastCall: LlmLastCall | null;
  updatedAt: string | null;
}

@Injectable()
export class LlmStatusService {
  constructor(@InjectQueue(QUEUE_NAME) private readonly queue: Queue) {}

  async get(): Promise<LlmStatus> {
    const offline: LlmStatus = {
      workerOnline: false,
      configured: false,
      model: null,
      lastCall: null,
      updatedAt: null,
    };

    try {
      const client = await this.queue.client;
      const raw = await client.get(LLM_STATUS_KEY);
      if (!raw) return offline;

      const parsed = JSON.parse(raw) as Partial<LlmStatus>;

      return {
        workerOnline: true,
        configured: Boolean(parsed.configured),
        model: parsed.model ?? null,
        ...(typeof parsed.sttConfigured === 'boolean' && { sttConfigured: parsed.sttConfigured }),
        ...((typeof parsed.sttModel === 'string' || parsed.sttModel === null) && { sttModel: parsed.sttModel }),
        lastCall: parsed.lastCall ?? null,
        updatedAt: parsed.updatedAt ?? null,
      };
    } catch {
      // Redis tidak tersedia atau data rusak: anggap worker offline.
      return offline;
    }
  }
}
