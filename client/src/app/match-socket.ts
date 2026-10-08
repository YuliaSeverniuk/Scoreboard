import { Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, filter, map, repeat, retry, scan, timer } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';
import { Command, PROTOCOL_VERSION, ServerMessage } from './protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

const WS_URL = `ws://${location.hostname}:3000/ws`;
const MAX_BACKOFF_MS = 5000;

function backoff(attempt: number) {
  return timer(Math.min(500 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
}

function isServerMessage(msg: unknown): msg is ServerMessage {
  const m = msg as Partial<ServerMessage> | null;
  return (m?.type === 'hello' || m?.type === 'state') && typeof m.seq === 'number';
}

@Injectable({ providedIn: 'root' })
export class MatchSocket {
    readonly status = signal<ConnectionStatus>('connecting');

    private readonly socket = webSocket<unknown>({
      url: WS_URL,
      openObserver: { next: () => this.status.set('open') },
      closeObserver: { next: () => this.status.set('closed') },
    });

    private readonly messages$ = this.socket.pipe(
      retry({ delay: (_err, attempt) => backoff(attempt), resetOnSuccess: true }),
      repeat({ delay: () => backoff(1) }),
      filter(isServerMessage),
    );

    readonly state = toSignal(
      this.messages$.pipe(
        scan((last, msg) => {
          if (msg.type === 'hello') {
            if (msg.protocol !== PROTOCOL_VERSION) {
              console.warn(`Server speaks protocol v${msg.protocol}, client expects v${PROTOCOL_VERSION}`);
            }
            return msg;
        }
        return msg.seq > last.seq ? msg : last;
      }),
      map((msg) => msg.state),
      distinctUntilChanged(),
      ),
      { initialValue: null },
    );

    send(command: Command): boolean {
      if (this.status() !== 'open') return false;
      this.socket.next({ event: 'command', data: command });
      return true;
    }
}