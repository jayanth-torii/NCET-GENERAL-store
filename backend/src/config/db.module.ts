import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { DbService } from './db';
import { ensureMongoIndexes } from './mongo-indexes';

/** On start-up: make sure every index exists, id sequences are ahead of the data, optional fields are present. */
@Injectable()
export class MongoBoot {
  private readonly log = new Logger('MongoBoot');
  constructor() {
    void this.run(1);
  }
  /** A network drop at start-up is retried a few times, 30 s apart; the API serves requests meanwhile. */
  private async run(attempt: number) {
    try {
      await ensureMongoIndexes();
    } catch (e) {
      if (attempt >= 5) return this.log.error(`Index setup failed: ${(e as Error).message}`);
      this.log.warn(`Index setup will be retried in 30 s (${(e as Error).message.slice(0, 120)})`);
      setTimeout(() => void this.run(attempt + 1), 30_000).unref();
    }
  }
}

@Global()
@Module({
  providers: [DbService, MongoBoot],
  exports: [DbService],
})
export class DbModule {}
