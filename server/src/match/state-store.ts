import { Injectable, Logger } from '@nestjs/common';
import { closeSync, fsyncSync, openSync, readFileSync, writeSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MatchState } from './protocol';

const SCHEMA_VERSION = 1;

export abstract class StateStore {
    abstract load(): MatchState | null;
    abstract save(state: MatchState): void;
}

@Injectable()
export class FileStateStore extends StateStore {
    private readonly logger = new Logger(FileStateStore.name);
    private readonly file = process.env.STATE_FILE ?? join(process.cwd(), 'data', 'match-state.json');

    constructor() {
        super();
        mkdirSync(dirname(this.file), { recursive: true });
    }

    load(): MatchState | null {
        try{
            const saved = JSON.parse(readFileSync(this.file, 'utf8'));
            if (saved.version !== SCHEMA_VERSION) {
                this.logger.warn(`Unknown schema ${saved.schema}, starting fresh`);
                return null;
            }
            return saved.state as MatchState;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.logger.error(`Cannot read ${this.file}, starting fresh: ${err}`);
            }
            return null;
        }
    }

    save(state: MatchState): void {
        const tmp = `${this.file}.tmp`;
        const fd = openSync(tmp, 'w');
        try{
            writeSync(fd, JSON.stringify({ schema: SCHEMA_VERSION, savedAt: new Date().toISOString(), state }));
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
        renameSync(tmp, this.file);
    }

}
