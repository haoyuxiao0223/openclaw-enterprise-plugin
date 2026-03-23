import type { QueueBackend, QueueMessage } from "../../kernel/queue.ts";
import type { PaginatedResult } from "../../kernel/types.ts";

export interface DeadLetterManager {
  getMessages(
    queue: string,
    offset?: number,
    limit?: number,
  ): Promise<PaginatedResult<QueueMessage>>;
  replay(queue: string, messageId: string): Promise<void>;
  getStats(): Promise<Record<string, number>>;
}

export class DeadLetterManager implements DeadLetterManager {
  constructor(
    private readonly queue: QueueBackend,
    private readonly statsQueues: readonly string[] = [],
  ) {}

  async getMessages(
    queue: string,
    offset?: number,
    limit?: number,
  ): Promise<PaginatedResult<QueueMessage>> {
    return this.queue.getDeadLetterMessages(queue, { offset, limit });
  }

  async replay(queue: string, messageId: string): Promise<void> {
    await this.queue.replayDeadLetter(queue, messageId);
  }

  async getStats(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const q of this.statsQueues) {
      const page = await this.queue.getDeadLetterMessages(q, { offset: 0, limit: 1 });
      counts[q] = page.total;
    }
    return counts;
  }
}
