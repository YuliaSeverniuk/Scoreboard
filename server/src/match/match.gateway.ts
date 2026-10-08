import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import { Server, WebSocket } from 'ws';
import { MatchService } from './match.service';
import { parseCommand } from './parse-command';
import { PROTOCOL_VERSION, ServerMessage } from './protocol';

@WebSocketGateway({ path: '/ws' })
export class MatchGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
    private readonly logger = new Logger(MatchGateway.name);
    private subscription?: Subscription;

    @WebSocketServer()
    private readonly server!: Server;

    constructor(private readonly match: MatchService) {}

    afterInit(): void {
      this.subscription = this.match.snapshots$.subscribe(({ seq, state }) => this.broadcast({ type: 'state', seq, state }));
    }

    onModuleDestroy(): void {
      this.subscription?.unsubscribe();
    }

    handleConnection(client: WebSocket): void {
      const { seq, state } = this.match.snapshot();
      this.send(client, { type: 'hello', protocol: PROTOCOL_VERSION, seq, state });
      this.logger.log(`Client connected, total: ${this.server.clients.size}`);
    }

    handleDisconnect(): void {
      this.logger.log(`Client disconnected, total: ${this.server.clients.size}`);
    }

    @SubscribeMessage('command')
    onCommand(@MessageBody() data: unknown): void {
      const cmd = parseCommand(data);
      if (!cmd) {
        this.logger.warn(`Ignored invalid command: ${JSON.stringify(data)}`);
       return;
      }
      this.match.apply(cmd);
    }

    private broadcast(msg: ServerMessage): void {
      const json = JSON.stringify(msg);
      for (const client of this.server.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(json);
      }
    }

    private send(client: WebSocket, msg: ServerMessage): void {
      client.send(JSON.stringify(msg));
    }
}


