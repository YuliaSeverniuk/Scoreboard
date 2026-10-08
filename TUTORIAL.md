# Пульт табло: pet-проєкт за 3 дні

Міні-версія того, що описано у вакансії Nevco:

```
┌──────────────────────── ваш ноутбук = "пристрій" ─────────────────────────┐
│                                                                            │
│  NestJS-сервіс (порт 3000)                Angular-застосунок (порт 4200)  │
│  ┌──────────────────────┐   WebSocket     ┌─────────────────────────────┐  │
│  │ MatchService         │ ──state/hello─► │ /board   верхній екран      │  │
│  │  стан матчу, годинник│                 │          (Canvas-рендерер)  │  │
│  │ MatchGateway  /ws    │ ◄──command───── │ /control нижній екран       │  │
│  │ FileStateStore       │                 │          (8 кнопок 1–8)     │  │
│  └─────────┬────────────┘                 └─────────────────────────────┘  │
│            ▼                                                               │
│   data/match-state.json  ← переживає "висмикнутий шнур"                    │
└────────────────────────────────────────────────────────────────────────────┘
```

| Вимога вакансії | Де в проєкті |
|---|---|
| Node.js / NestJS, стан матчу | День 1: `MatchService`, `MatchGateway` |
| Відновлення після втрати живлення | День 1: `FileStateStore` (атомарний запис), відновлення в `MatchService` |
| WebSocket: перепідключення, порядок, сумісність | День 1: протокол з `seq` і `hello`; День 2: `MatchSocket` |
| RxJS: потоки, teardown, без витоків | День 2: `retry`/`repeat`/`scan`/`toSignal`; `effect` з `onCleanup` |
| Canvas з frame budget | День 2: бібліотека `board-renderer` + `requestAnimationFrame` |
| Рендерер з JSON layout schema | День 2: `layouts/basketball.json` |
| Angular: standalone, signals | День 2–3: усі компоненти standalone, стан у signals |
| Фізичні кнопки без тачскріну | День 3: `ControlPage`, клавіші 1–8, автоповтор, "LED" |
| Kiosk mode | День 3: запуск Chrome з `--kiosk` |
| Jest | Дні 1 і 3: unit-тести |

**Версії** взяті з вакансії: NestJS 10 + Jest на сервері, Angular 21 + TypeScript 5.9 на клієнті.

> **Як працювати з туторіалом.** Не копіюйте код бездумно: передрукуйте його або хоча б
> прочитайте кожен рядок перед вставкою. Після кожного кроку пояснення, *навіщо* так зроблено.
> Саме ці "навіщо" потім звучать на технічній співбесіді. Готовий робочий проєкт лежить поруч
> (`server/`, `client/`), туди можна підглядати.

## Підготовка (15 хв)

1. Node.js 22 LTS (у вакансії Node 22 для розробки). Перевірити: `node -v`.
2. VS Code. Корисні розширення: Angular Language Service, ESLint.
3. Створіть порожню папку `scoreboard`. Усі команди нижче виконуються з неї.

---

# День 1 — NestJS-сервіс: стан матчу, WebSocket, живлення

## 1.1 Створення проєкту

```bash
npx @nestjs/cli@10 new server --skip-git --package-manager npm --strict
```

```bash
cd server
npm i @nestjs/websockets@10 @nestjs/platform-ws@10 ws@8
npm i -D @types/ws
```

Видаліть шаблонні файли, вони не знадобляться: `src/app.controller.ts`, `src/app.controller.spec.ts`,
`src/app.service.ts`, `test/app.e2e-spec.ts`. Створіть папку `src/match`.

**Чому `@nestjs/platform-ws`, а не Socket.IO?** Socket.IO має власний протокол поверх WebSocket,
важчий клієнт і "магію" перепідключення. На слабкому пристрої і з власним клієнтом простіше й
прозоріше чистий WebSocket. До того ж перепідключення ми напишемо самі, а у вакансії про це питають.

## 1.2 Протокол — контракт між сервером і екранами

`src/match/protocol.ts`

```ts
// Контракт між сервером і клієнтами. Такий самий файл лежить у client/src/app/protocol.ts.
// У реальному проєкті (Nx monorepo) це була б спільна бібліотека, яку імпортують обидві сторони.

export const PROTOCOL_VERSION = 1;

export type Team = 'home' | 'away';

export interface TeamState {
  name: string;
  score: number;
  fouls: number;
}

export interface MatchState {
  home: TeamState;
  away: TeamState;
  period: number;
  clock: {
    remainingMs: number;
    running: boolean;
  };
  horn: boolean;
}

// Клієнт -> сервер (всередині конверта { event: 'command', data: Command })
export type Command =
  | { type: 'score'; team: Team; delta: number }
  | { type: 'foul'; team: Team; delta: number }
  | { type: 'clock.start' }
  | { type: 'clock.stop' }
  | { type: 'period.next' }
  | { type: 'horn' }
  | { type: 'reset' };

// Сервер -> клієнт
export type ServerMessage =
  | { type: 'hello'; protocol: number; seq: number; state: MatchState }
  | { type: 'state'; seq: number; state: MatchState };
```

**Що тут важливо:**

- **Discriminated unions** (`type: 'score' | 'foul' | ...`): TypeScript у `switch (cmd.type)` сам
  звужує тип і знає, що в `score` є `team` і `delta`, а в `clock.start` немає.
- **`seq`** — номер версії стану, що росте з кожною зміною. Клієнт за ним відкидає застарілі
  повідомлення, і стан на екрані ніколи не "відкотиться" назад.
- **`hello`** — перше повідомлення після підключення, з повним станом і версією протоколу.
  Завдяки цьому після обриву зв'язку клієнту не треба нічого "доздоганяти": він просто отримує все заново.
- **Повний стан, а не зміни (snapshot, not delta).** Стан крихітний (кількасот байтів), тож простіше
  щоразу надсилати його весь. Загублене повідомлення тоді нічого не ламає.

## 1.3 Валідація вхідних команд

`src/match/parse-command.ts`

```ts
import { Command, Team } from './protocol';

const TEAMS: readonly Team[] = ['home', 'away'];
const SIMPLE_COMMANDS = ['clock.start', 'clock.stop', 'period.next', 'horn', 'reset'] as const;

// Усе, що приходить з мережі, — це unknown, поки ми це не перевірили.
// Невідомі поля ігноруємо (tolerant reader), невідомі команди відкидаємо.
export function parseCommand(raw: unknown): Command | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as Record<string, unknown>;

  if (msg.type === 'score' || msg.type === 'foul') {
    const team = msg.team as Team;
    const delta = msg.delta;
    if (!TEAMS.includes(team)) return null;
    if (typeof delta !== 'number' || !Number.isInteger(delta) || Math.abs(delta) > 3) return null;
    return { type: msg.type, team, delta };
  }

  const simple = SIMPLE_COMMANDS.find((t) => t === msg.type);
  return simple ? { type: simple } : null;
}
```

**Ідея "tolerant reader":** невідомі *поля* ігноруємо, бо новий клієнт може надсилати
більше, ніж знає старий сервер, і це не повинно все ламати. А невідомі *команди* відкидаємо.
Це одна з відповідей на вимогу вакансії *"keeping old clients working when the protocol changes"*.

## 1.4 Збереження стану: переживаємо втрату живлення

`src/match/state-store.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MatchState } from './protocol';

const SCHEMA_VERSION = 1;

// Абстрактний клас працює як DI-токен: у тестах підставляємо реалізацію в пам'яті.
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
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (saved.schema !== SCHEMA_VERSION) {
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

  // Атомарний запис: пишемо в тимчасовий файл, скидаємо на диск (fsync),
  // потім одним rename підміняємо старий. Якщо живлення пропаде посередині,
  // на диску залишиться або старий файл, або новий, але ніколи не половина.
  save(state: MatchState): void {
    const tmp = `${this.file}.tmp`;
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, JSON.stringify({ schema: SCHEMA_VERSION, savedAt: new Date().toISOString(), state }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.file);
  }
}
```

**Чому саме так:**

- Якщо писати прямо в `match-state.json`, а живлення зникне посеред запису, на диску лишиться
  обрізаний JSON, і після ввімкнення пульт не зможе прочитати стан. Схема **write tmp → fsync → rename**
  гарантує, що файл буде або старий, або новий цілком, бо `rename` атомарний на рівні файлової системи.
- `fsyncSync` змушує ОС реально скинути дані на флеш, а не тримати їх у кеші.
- `schema: 1` у файлі потрібна для майбутнього: коли формат зміниться, нова версія софту зможе
  розпізнати старий файл.
- **Абстрактний клас як DI-токен.** `MatchService` залежить від `StateStore`, а не від файлів.
  У тестах підставимо сховище в пам'яті. Це звичайний Dependency Inversion, знайомий вам зі Spring.
- Синхронні виклики (`writeSync`) у Node зазвичай погана ідея, бо блокують event loop. Але тут
  файл крихітний, а гарантія порядку записів важливіша. На співбесіді варто показати, що ви
  розумієте цей компроміс.

## 1.5 MatchService — серце системи

`src/match/match.service.ts`

```ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { BehaviorSubject } from 'rxjs';
import { Command, MatchState, Team } from './protocol';
import { StateStore } from './state-store';

export const PERIOD_MS = Number(process.env.PERIOD_SECONDS ?? 600) * 1000;
const TICK_MS = 100;
const HORN_MS = 2000;
// Годинник змінюється 10 разів на секунду, але flash-пам'ять не любить частих записів.
// Тому дискретні події (рахунок, фол) зберігаємо одразу, а годинник — не частіше разу на секунду.
const PERSIST_CLOCK_EVERY_MS = 1000;

export interface Snapshot {
  seq: number;
  state: MatchState;
}

export function initialState(): MatchState {
  return {
    home: { name: 'HOME', score: 0, fouls: 0 },
    away: { name: 'GUEST', score: 0, fouls: 0 },
    period: 1,
    clock: { remainingMs: PERIOD_MS, running: false },
    horn: false,
  };
}

@Injectable()
export class MatchService implements OnModuleDestroy {
  private readonly logger = new Logger(MatchService.name);

  private state: MatchState;
  private seq = 0;

  // Годинник рахуємо від моменту старту, а не віднімаючи по 100 мс на кожен тік:
  // setInterval не точний, і похибка накопичувалась би.
  // performance.now() монотонний: він не стрибає, коли пристрій синхронізує системний час.
  private runningSince: number | null = null;
  private remainingAtStart = 0;
  private tickTimer?: NodeJS.Timeout;
  private hornTimer?: NodeJS.Timeout;
  private lastPersistAt = 0;

  private readonly snapshots: BehaviorSubject<Snapshot>;
  readonly snapshots$;

  constructor(private readonly store: StateStore) {
    const saved = store.load();
    if (saved) {
      // Відновлення після втрати живлення: рахунок і час беремо з диска,
      // але годинник ставимо на паузу. Оператор сам вирішить, коли продовжити гру.
      this.state = { ...saved, horn: false, clock: { ...saved.clock, running: false } };
      this.logger.warn(`Recovered match state, clock paused at ${saved.clock.remainingMs} ms`);
    } else {
      this.state = initialState();
    }
    this.snapshots = new BehaviorSubject<Snapshot>(this.snapshot());
    this.snapshots$ = this.snapshots.asObservable();
  }

  snapshot(): Snapshot {
    return { seq: this.seq, state: this.state };
  }

  apply(cmd: Command): void {
    switch (cmd.type) {
      case 'score':
        return this.changeTeam(cmd.team, 'score', cmd.delta);
      case 'foul':
        return this.changeTeam(cmd.team, 'fouls', cmd.delta);
      case 'clock.start':
        return this.startClock();
      case 'clock.stop':
        return this.stopClock();
      case 'period.next':
        return this.nextPeriod();
      case 'horn':
        return this.soundHorn();
      case 'reset':
        this.stopClock();
        return this.commit(initialState());
    }
  }

  onModuleDestroy(): void {
    // Штатне вимкнення: зупиняємо таймери і зберігаємо фінальний стан.
    clearInterval(this.tickTimer);
    clearTimeout(this.hornTimer);
    this.store.save({ ...this.state, clock: { ...this.state.clock, remainingMs: this.currentRemaining() } });
    this.snapshots.complete();
  }

  private changeTeam(team: Team, field: 'score' | 'fouls', delta: number): void {
    const current = this.state[team];
    const value = Math.min(999, Math.max(0, current[field] + delta));
    this.commit({ ...this.state, [team]: { ...current, [field]: value } });
  }

  private startClock(): void {
    const { running, remainingMs } = this.state.clock;
    if (running || remainingMs <= 0) return;
    this.runningSince = performance.now();
    this.remainingAtStart = remainingMs;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.setClock(remainingMs, true);
  }

  private stopClock(): void {
    if (!this.state.clock.running) return;
    const remaining = this.currentRemaining();
    clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    this.runningSince = null;
    this.setClock(remaining, false);
  }

  private tick(): void {
    const remaining = this.currentRemaining();
    if (remaining === 0) {
      this.stopClock();
      this.soundHorn();
      return;
    }
    this.setClock(remaining, true, 'throttled');
  }

  private currentRemaining(): number {
    if (this.runningSince === null) return this.state.clock.remainingMs;
    const elapsed = performance.now() - this.runningSince;
    return Math.max(0, Math.round(this.remainingAtStart - elapsed));
  }

  private setClock(remainingMs: number, running: boolean, persist: 'now' | 'throttled' = 'now'): void {
    this.commit({ ...this.state, clock: { remainingMs, running } }, persist);
  }

  private nextPeriod(): void {
    this.stopClock();
    this.commit({
      ...this.state,
      period: this.state.period + 1,
      clock: { remainingMs: PERIOD_MS, running: false },
      home: { ...this.state.home, fouls: 0 },
      away: { ...this.state.away, fouls: 0 },
    });
  }

  private soundHorn(): void {
    clearTimeout(this.hornTimer);
    this.commit({ ...this.state, horn: true });
    this.hornTimer = setTimeout(() => this.commit({ ...this.state, horn: false }), HORN_MS);
  }

  // Єдине місце, де змінюється стан: новий номер seq, збереження на диск, розсилка.
  private commit(next: MatchState, persist: 'now' | 'throttled' = 'now'): void {
    this.state = next;
    this.seq++;

    const now = performance.now();
    if (persist === 'now' || now - this.lastPersistAt >= PERSIST_CLOCK_EVERY_MS) {
      this.store.save(next);
      this.lastPersistAt = now;
    }

    this.snapshots.next(this.snapshot());
  }
}
```

**Розбір по частинах:**

1. **Єдина точка зміни — `commit()`.** Будь-яка зміна стану проходить тут: `seq++`, запис на диск,
   розсилка. Забути щось із цього неможливо.
2. **Незмінний (immutable) стан.** Ми не робимо `state.home.score++`, а створюємо новий об'єкт через
   spread. Старі snapshot-и, які вже пішли підписникам, не змінюються "під ногами".
3. **`BehaviorSubject`** зберігає останнє значення: новий підписник одразу отримує поточний стан.
   Назовні віддаємо лише `asObservable()`, щоб ніхто, крім сервісу, не міг викликати `next()`.
4. **Годинник.** Не віднімаємо по 100 мс на кожен тік: `setInterval` неточний, і за 10 хвилин
   набіжать секунди похибки. Ми запам'ятовуємо момент старту й щоразу обчислюємо
   `remainingAtStart - elapsed`.
5. **`performance.now()`, а не `Date.now()`.** Системний годинник може стрибнути, наприклад коли
   пристрій без батарейки RTC отримає мережу і синхронізує час через NTP. Монотонний годинник не
   стрибає ніколи.
6. **Запис на флеш з обмеженням частоти.** Подія (рахунок, фол) зберігається одразу, а годинник,
   який змінюється 10 разів на секунду, — не частіше разу на секунду. Флеш-пам'ять має обмежену
   кількість циклів запису. Ціна компромісу: після аварії можна втратити до 1 секунди ігрового часу.
7. **Відновлення.** Після перезапуску беремо стан з диска, але годинник ставимо на паузу. Пульт не
   може знати, скільки часу був вимкнений і чи йшла гра. Безпечніше, щоб оператор сам натиснув START.

## 1.6 Gateway, модуль, main.ts

`src/match/match.gateway.ts`

```ts
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

  // Новий (або перепідключений) клієнт одразу отримує повний стан.
  // Тому після обриву зв'язку клієнту нічого не треба "доздогоняти".
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
```

`src/match/match.module.ts`

```ts
import { Module } from '@nestjs/common';
import { MatchGateway } from './match.gateway';
import { MatchService } from './match.service';
import { FileStateStore, StateStore } from './state-store';

@Module({
  providers: [MatchService, MatchGateway, { provide: StateStore, useClass: FileStateStore }],
})
export class MatchModule {}
```

`src/app.module.ts`

```ts
import { Module } from '@nestjs/common';
import { MatchModule } from './match/match.module';

@Module({
  imports: [MatchModule],
})
export class AppModule {}
```

`src/main.ts`

```ts
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Чистий WebSocket (бібліотека ws) замість Socket.IO: легший і без власного протоколу поверх.
  app.useWebSocketAdapter(new WsAdapter(app));
  // На SIGTERM/SIGINT Nest викличе onModuleDestroy, і ми встигнемо зберегти стан.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

**Що тут важливо:**

- `WsAdapter` очікує від клієнта повідомлення у форматі `{ "event": "command", "data": {...} }`
  і за полем `event` знаходить метод з `@SubscribeMessage('command')`.
- **Teardown на сервері.** Підписку на `snapshots$` зберігаємо і скасовуємо в `onModuleDestroy`.
  Той самий принцип "no subscription leaks", що й в Angular.
- `enableShutdownHooks()`: при Ctrl+C або `systemctl stop` Nest викличе `onModuleDestroy`, і
  `MatchService` збереже фінальний стан. При раптовій втраті живлення цього не станеться, і тоді
  рятує запис після кожної зміни.

## 1.7 Запуск і перевірка

```bash
npm run start:dev
```

У логах має з'явитися `MatchGateway subscribed to the "command" message`.

Скопіюйте з готового проєкту папку `server/scripts` (два маленькі тестові клієнти). У **другому** терміналі:

```bash
node scripts/ws-smoke.js
```

Очікуваний результат: `hello`, потім `state` з рахунком 3, далі годинник іде, а в логах сервера
`Ignored invalid command: {"type":"self-destruct"}`. Сміттєвий рядок `not json at all` сервер
мовчки проігнорував і не впав.

**Головний тест — "висмикнути шнур":**

1. `node scripts/power-loss.js play` — пише рахунок 2:3, фол і запускає годинник.
2. Подивіться в лог сервера на PID у кожному рядку: `[Nest] 12345 - ...`.
3. Вбийте процес *жорстко*, без шансу щось зберегти (аналог втрати живлення):

```bash
taskkill /F /PID 12345
```

Ctrl+C тут не підходить: це штатне вимкнення, і воно викличе `onModuleDestroy`.

4. Подивіться `data/match-state.json`: там рахунок і `"running": true`.
5. Запустіть сервер знову (`npm run start:dev`). У лозі має бути
   `WARN [MatchService] Recovered match state, clock paused at ...`.
6. `node scripts/power-loss.js check` покаже той самий рахунок і `"running": false`.

> Порада: щоб швидко побачити кінець періоду й сирену, запустіть сервер з коротким періодом.
> PowerShell: `$env:PERIOD_SECONDS=10; npm run start:dev`. Git Bash: `PERIOD_SECONDS=10 npm run start:dev`.

## 1.8 Unit-тести (Jest)

`src/match/match.service.spec.ts`

```ts
import { Test } from '@nestjs/testing';
import { MatchService, PERIOD_MS, initialState } from './match.service';
import { MatchState } from './protocol';
import { StateStore } from './state-store';

class MemoryStore extends StateStore {
  saved: MatchState | null = null;
  saves = 0;
  load() {
    return this.saved;
  }
  save(state: MatchState) {
    this.saved = state;
    this.saves++;
  }
}

describe('MatchService', () => {
  let store: MemoryStore;

  async function createService(): Promise<MatchService> {
    const moduleRef = await Test.createTestingModule({
      providers: [MatchService, { provide: StateStore, useValue: store }],
    }).compile();
    return moduleRef.get(MatchService);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    store = new MemoryStore();
  });

  afterEach(() => jest.useRealTimers());

  it('changes score and never goes below zero', async () => {
    const match = await createService();
    match.apply({ type: 'score', team: 'home', delta: 2 });
    match.apply({ type: 'score', team: 'away', delta: -1 });

    expect(match.snapshot().state.home.score).toBe(2);
    expect(match.snapshot().state.away.score).toBe(0);
  });

  it('increments seq on every change', async () => {
    const match = await createService();
    const seqs: number[] = [];
    match.snapshots$.subscribe((s) => seqs.push(s.seq));

    match.apply({ type: 'score', team: 'home', delta: 1 });
    match.apply({ type: 'foul', team: 'away', delta: 1 });

    expect(seqs).toEqual([0, 1, 2]);
  });

  it('counts the clock down while running', async () => {
    const match = await createService();
    match.apply({ type: 'clock.start' });
    jest.advanceTimersByTime(3000);
    match.apply({ type: 'clock.stop' });

    expect(match.snapshot().state.clock).toEqual({ remainingMs: PERIOD_MS - 3000, running: false });
  });

  it('stops at zero and sounds the horn', async () => {
    const match = await createService();
    match.apply({ type: 'clock.start' });
    jest.advanceTimersByTime(PERIOD_MS + 500);

    const { clock, horn } = match.snapshot().state;
    expect(clock).toEqual({ remainingMs: 0, running: false });
    expect(horn).toBe(true);

    jest.advanceTimersByTime(2000);
    expect(match.snapshot().state.horn).toBe(false);
  });

  it('saves the clock to disk at most once per second', async () => {
    const match = await createService();
    match.apply({ type: 'clock.start' });
    const savesAfterStart = store.saves;

    jest.advanceTimersByTime(5000); // 50 тіків

    expect(store.saves - savesAfterStart).toBeLessThanOrEqual(5);
  });

  it('recovers saved state after power loss with the clock paused', async () => {
    store.saved = {
      ...initialState(),
      home: { name: 'HOME', score: 42, fouls: 3 },
      clock: { remainingMs: 123_000, running: true },
      horn: true,
    };

    const match = await createService();
    const { state } = match.snapshot();

    expect(state.home.score).toBe(42);
    expect(state.clock).toEqual({ remainingMs: 123_000, running: false });
    expect(state.horn).toBe(false);
  });
});
```

`src/match/parse-command.spec.ts`

```ts
import { parseCommand } from './parse-command';

describe('parseCommand', () => {
  it('accepts valid commands', () => {
    expect(parseCommand({ type: 'score', team: 'home', delta: 3 })).toEqual({ type: 'score', team: 'home', delta: 3 });
    expect(parseCommand({ type: 'clock.start' })).toEqual({ type: 'clock.start' });
  });

  it('ignores unknown extra fields (tolerant reader)', () => {
    expect(parseCommand({ type: 'horn', addedInV2: true })).toEqual({ type: 'horn' });
  });

  it('rejects garbage', () => {
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand('score')).toBeNull();
    expect(parseCommand({ type: 'score', team: 'referee', delta: 1 })).toBeNull();
    expect(parseCommand({ type: 'score', team: 'home', delta: 100 })).toBeNull();
    expect(parseCommand({ type: 'self-destruct' })).toBeNull();
  });
});
```

```bash
npx jest
```

**Що тут показово:**

- `jest.useFakeTimers()` підміняє `setInterval`, `setTimeout` і `performance.now()`.
  `advanceTimersByTime(PERIOD_MS)` "прокручує" 10 хвилин гри за мілісекунди.
- `MemoryStore` замість файлів. Саме для цього `StateStore` був абстрактним класом.
- Тест "не частіше разу на секунду" перевіряє вимогу до заліза (ресурс флешу), а не лише логіку.

### ✅ Кінець дня 1. Ви можете пояснити:

- як стан переживає втрату живлення (атомарний запис, fsync, пауза годинника після відновлення);
- чому годинник рахується від моменту старту і на монотонному часі;
- навіщо в протоколі `seq` і `hello`;
- як NestJS DI дозволяє підмінити сховище в тестах.

---

# День 2 — Рендерер табло і Angular-клієнт

## 2.1 Створення Angular-застосунку

З папки `scoreboard`:

```bash
npx @angular/cli@21 new client --routing --style=css --skip-git --ssr=false --zoneless --ai-config=none
```

```bash
cd client
```

Видаліть `src/app/app.html`, `src/app/app.css`, `src/app/app.spec.ts`. Створіть папки
`src/lib/board-renderer`, `src/app/pages`, `src/app/board-canvas`, `public/layouts`.

Скопіюйте `server/src/match/protocol.ts` у `client/src/app/protocol.ts`.

**Zoneless.** В Angular 21 це вже стандарт: без zone.js. Зміни відстежуються через signals, тому
весь стан у нас буде в signals.

## 2.2 Бібліотека `board-renderer` (без Angular!)

Це відповідь на пункт вакансії *"standalone TypeScript library … from a JSON layout schema"*.
У бібліотеці **жодного імпорту з `@angular`**: тільки TypeScript і Canvas API. Тому її можна
використати будь-де: в Angular, в конфігураторі табло на React, в Node для генерації прев'ю-картинок.

`src/lib/board-renderer/layout.ts` — схема:

```ts
// JSON-схема "обличчя" табло. Рендерер не знає нічого про баскетбол чи MatchState:
// він бере layout + довільні дані і малює те, на що вказують шляхи в `bind` ("home.score").
// x — центр елемента; y — верх для digits/clock і центр для text/indicator.

export interface BoardLayout {
  width: number;
  height: number;
  background: string;
  elements: BoardElement[];
}

export type BoardElement = TextElement | DigitsElement | ClockElement | IndicatorElement;

export interface TextElement {
  type: 'text';
  x: number;
  y: number;
  text?: string; // статичний підпис...
  bind?: string; // ...або значення з даних
  size: number;
  color: string;
}

export interface DigitsElement {
  type: 'digits';
  x: number;
  y: number;
  bind: string;
  digits: number;
  height: number;
  color: string;
}

export interface ClockElement {
  type: 'clock';
  x: number;
  y: number;
  bind: string; // мілісекунди, що лишилися
  height: number;
  color: string;
}

export interface IndicatorElement {
  type: 'indicator';
  x: number;
  y: number;
  bind: string; // boolean
  radius: number;
  color: string;
}
```

`src/lib/board-renderer/seven-segment.ts` — цифри як на справжньому табло:

```ts
//  aaa
// f   b
//  ggg
// e   c
//  ddd
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};

// Пропорції відносно висоти цифри.
const DIGIT_WIDTH = 0.55;
const THICKNESS = 0.12;
const SPACING = 0.15;
const SEPARATOR_WIDTH = 0.3; // для ':' і '.'
// Справжні табло показують і погаслі сегменти, ледь помітно.
const OFF_ALPHA = 0.1;

function charWidth(ch: string, h: number): number {
  return ch === ':' || ch === '.' ? h * SEPARATOR_WIDTH : h * DIGIT_WIDTH;
}

export function measureSegmentText(text: string, h: number): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch, h) + h * SPACING;
  return width - h * SPACING;
}

// Малює рядок на кшталт "12:34" або " 7" так, щоб його центр був у x.
export function drawSegmentText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, h: number, color: string): void {
  let cursor = x - measureSegmentText(text, h) / 2;
  ctx.fillStyle = color;
  for (const ch of text) {
    if (ch === ':' || ch === '.') {
      drawSeparator(ctx, ch, cursor, y, h);
    } else {
      drawDigit(ctx, SEGMENTS[ch] ?? '', cursor, y, h);
    }
    cursor += charWidth(ch, h) + h * SPACING;
  }
}

function drawDigit(ctx: CanvasRenderingContext2D, lit: string, x: number, y: number, h: number): void {
  const w = h * DIGIT_WIDTH;
  const t = h * THICKNESS;
  const half = h / 2;
  const vertical = half - t * 1.5;
  const rects: Record<string, [number, number, number, number]> = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, vertical],
    c: [x + w - t, y + half + t / 2, t, vertical],
    d: [x + t, y + h - t, w - 2 * t, t],
    e: [x, y + half + t / 2, t, vertical],
    f: [x, y + t, t, vertical],
    g: [x + t, y + half - t / 2, w - 2 * t, t],
  };
  for (const [segment, [rx, ry, rw, rh]] of Object.entries(rects)) {
    ctx.globalAlpha = lit.includes(segment) ? 1 : OFF_ALPHA;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, t / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSeparator(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, h: number): void {
  const r = h * THICKNESS * 0.6;
  const cx = x + (h * SEPARATOR_WIDTH) / 2;
  const dots = ch === ':' ? [y + h * 0.3, y + h * 0.7] : [y + h - r];
  for (const cy of dots) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
```

`src/lib/board-renderer/render-board.ts`

```ts
import { BoardElement, BoardLayout } from './layout';
import { drawSegmentText } from './seven-segment';

// "home.score" -> data.home.score
export function resolve(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((obj, key) => (obj as Record<string, unknown> | undefined)?.[key], data);
}

// Як на справжніх табло: від хвилини і більше "MM:SS", останню хвилину "SS.t".
export function formatClock(ms: number): string {
  if (ms >= 60_000) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, ' ')}:${String(seconds).padStart(2, '0')}`;
  }
  const tenths = Math.floor(ms / 100);
  return `${String(Math.floor(tenths / 10)).padStart(2, ' ')}.${tenths % 10}`;
}

export function renderBoard(ctx: CanvasRenderingContext2D, layout: BoardLayout, data: unknown): void {
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const element of layout.elements) {
    renderElement(ctx, element, data);
  }
}

function renderElement(ctx: CanvasRenderingContext2D, el: BoardElement, data: unknown): void {
  switch (el.type) {
    case 'text': {
      const text = el.bind ? String(resolve(data, el.bind) ?? '') : (el.text ?? '');
      ctx.fillStyle = el.color;
      ctx.font = `bold ${el.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, el.x, el.y);
      return;
    }
    case 'digits': {
      const value = Number(resolve(data, el.bind) ?? 0);
      const text = String(value).padStart(el.digits, ' ').slice(-el.digits);
      drawSegmentText(ctx, text, el.x, el.y, el.height, el.color);
      return;
    }
    case 'clock': {
      const ms = Number(resolve(data, el.bind) ?? 0);
      drawSegmentText(ctx, formatClock(ms), el.x, el.y, el.height, el.color);
      return;
    }
    case 'indicator': {
      const on = resolve(data, el.bind) === true;
      ctx.fillStyle = el.color;
      ctx.globalAlpha = on ? 1 : 0.15;
      ctx.shadowColor = el.color;
      ctx.shadowBlur = on ? el.radius : 0;
      ctx.beginPath();
      ctx.arc(el.x, el.y, el.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      return;
    }
  }
}
```

`src/lib/board-renderer/index.ts` — публічний API:

```ts
// Публічний API бібліотеки. У Nx це був би окремий lib з власним package.json.
export * from './layout';
export { formatClock, renderBoard } from './render-board';
```

**Що тут важливо:**

- **Рендерер не знає про баскетбол.** Він отримує `data: unknown` і шляхи `bind: "home.score"`.
  Хокейне табло — це новий JSON, а не новий код.
- **Семисегментні цифри** — це 7 заокруглених прямокутників. Погаслі сегменти ледь світяться
  (`OFF_ALPHA`), як на справжніх LED-табло. Пробіл у рядку означає цифру, де всі сегменти погашені.
- **`formatClock`**: від хвилини і більше `MM:SS` з округленням секунд угору (на старті 10:00,
  а не 9:59), останню хвилину `SS.t` з десятими. Так працюють реальні баскетбольні табло.
- **Чиста функція** `renderBoard(ctx, layout, data)`: однакові вхідні дані дають однакову картинку.
  Це легко тестувати.

## 2.3 JSON layout

`public/layouts/basketball.json`

```json
{
  "width": 640,
  "height": 360,
  "background": "#050505",
  "elements": [
    { "type": "clock", "x": 320, "y": 20, "bind": "clock.remainingMs", "height": 90, "color": "#ffcc00" },

    { "type": "text", "x": 120, "y": 150, "bind": "home.name", "size": 28, "color": "#ffffff" },
    { "type": "digits", "x": 120, "y": 175, "bind": "home.score", "digits": 3, "height": 110, "color": "#ff3b30" },
    { "type": "text", "x": 85, "y": 325, "text": "FOULS", "size": 18, "color": "#aaaaaa" },
    { "type": "digits", "x": 160, "y": 307, "bind": "home.fouls", "digits": 1, "height": 36, "color": "#ff9500" },

    { "type": "text", "x": 520, "y": 150, "bind": "away.name", "size": 28, "color": "#ffffff" },
    { "type": "digits", "x": 520, "y": 175, "bind": "away.score", "digits": 3, "height": 110, "color": "#ff3b30" },
    { "type": "text", "x": 485, "y": 325, "text": "FOULS", "size": 18, "color": "#aaaaaa" },
    { "type": "digits", "x": 560, "y": 307, "bind": "away.fouls", "digits": 1, "height": 36, "color": "#ff9500" },

    { "type": "text", "x": 320, "y": 175, "text": "PERIOD", "size": 18, "color": "#aaaaaa" },
    { "type": "digits", "x": 320, "y": 195, "bind": "period", "digits": 1, "height": 60, "color": "#34c759" },
    { "type": "indicator", "x": 320, "y": 300, "bind": "horn", "radius": 14, "color": "#ff9500" },
    { "type": "text", "x": 320, "y": 330, "text": "HORN", "size": 14, "color": "#aaaaaa" }
  ]
}
```

Поекспериментуйте: змініть кольори, розміри, додайте елемент — і подивіться результат без жодної
зміни TypeScript-коду.

## 2.4 MatchSocket: WebSocket + RxJS + signals

`src/app/match-socket.ts`

```ts
import { Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, filter, map, repeat, retry, scan, timer } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';
import { Command, PROTOCOL_VERSION, ServerMessage } from './protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

const WS_URL = `ws://${location.hostname}:3000/ws`;
const MAX_BACKOFF_MS = 5000;

// 0.5 с, 1 с, 2 с, 4 с, 5 с, 5 с... щоб не "душити" сервер, який щойно перезапускається.
function backoff(attempt: number) {
  return timer(Math.min(500 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
}

// Повідомлення невідомих типів пропускаємо: так старий клієнт не зламається,
// коли новий сервер почне надсилати щось нове.
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
    // Сервер упав або зникла мережа -> error -> retry.
    // Сервер штатно закрив з'єднання (перезапуск) -> complete -> repeat.
    // Без repeat клієнт після штатного перезапуску сервера більше ніколи б не підключився.
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
          return msg; // новий сеанс: після перезапуску сервера seq починається заново
        }
        // Застаріле повідомлення або дубль ігноруємо: стан ніколи не "відкотиться" назад.
        return msg.seq > last.seq ? msg : last;
      }),
      map((msg) => msg.state),
      distinctUntilChanged(),
    ),
    { initialValue: null },
  );

  // Повертає false, якщо зв'язку немає. Натискання "в нікуди" ми свідомо не буферизуємо:
  // "+2 очки", натиснуте 10 секунд тому, не повинно раптом застосуватися після перепідключення.
  send(command: Command): boolean {
    if (this.status() !== 'open') return false;
    this.socket.next({ event: 'command', data: command });
    return true;
  }
}
```

**Це найважливіший файл для технічної співбесіди. Розберіть кожен оператор:**

- **`webSocket()` з `rxjs/webSocket`** — це `Subject`: підписка відкриває з'єднання, `next()` надсилає
  повідомлення. Коли підписок не лишається, з'єднання закривається (teardown).
- **`retry` + `repeat`.** Підступний момент. Якщо сервер *упав*, сокет завершується з `error`, і
  спрацює `retry`. А якщо сервер *штатно* закрив з'єднання (наприклад, при перезапуску), Observable
  просто *завершується* (`complete`), і `retry` не спрацює! Для цього потрібен `repeat`.
- **Exponential backoff** (0,5 → 1 → 2 → 4 → 5 с) не "душить" сервер, що перезавантажується.
  `resetOnSuccess: true` скидає лічильник після успішного з'єднання.
- **`scan` для порядку повідомлень.** Тримаємо останнє прийняте повідомлення й відкидаємо все зі
  старішим `seq`. Після `hello` приймаємо будь-який `seq`, бо після перезапуску сервера нумерація
  починається з нуля.
- **`distinctUntilChanged`.** Якщо прийшло застаріле повідомлення, `scan` поверне той самий об'єкт,
  і зайвого перемальовування не буде.
- **`toSignal`** перетворює Observable на signal і **сам відписується**, коли знищується injector.
  Жодного ручного `subscribe` — жодних витоків.
- **`send()` не буферизує команди офлайн.** Звичайний `WebSocketSubject` накопичує повідомлення,
  поки немає з'єднання. Для табло це небезпечно: "+3 очки", натиснуте 10 секунд тому, раптом
  застосувалося б після перепідключення. Краще чесно відмовити, щоб оператор побачив, що натискання
  не пройшло.

## 2.5 BoardCanvas: Canvas у кадровому бюджеті

`src/app/board-canvas/board-canvas.ts`

```ts
import { ChangeDetectionStrategy, Component, ElementRef, effect, input, viewChild } from '@angular/core';
import { BoardLayout, renderBoard } from '../../lib/board-renderer';

const FRAME_BUDGET_MS = 16;

@Component({
  selector: 'app-board-canvas',
  template: `<canvas #canvas></canvas>`,
  styles: `
    :host { display: block; }
    canvas { display: block; width: 100%; height: auto; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardCanvas {
  readonly layout = input.required<BoardLayout>();
  readonly data = input.required<unknown>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    // effect перезапускається щоразу, коли змінюється будь-який прочитаний сигнал.
    effect((onCleanup) => {
      const canvas = this.canvas().nativeElement;
      const layout = this.layout();
      const data = this.data();

      // Малюємо не одразу, а в найближчому кадрі. Якщо до кадру прийде новіший стан,
      // onCleanup скасує старий запит, і намалюється лише останній стан.
      const frame = requestAnimationFrame(() => this.draw(canvas, layout, data));
      onCleanup(() => cancelAnimationFrame(frame));
    });
  }

  private draw(canvas: HTMLCanvasElement, layout: BoardLayout, data: unknown): void {
    const started = performance.now();

    // Різкість на екранах з високою щільністю пікселів: буфер canvas більший за CSS-розмір.
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== layout.width * dpr) {
      canvas.width = layout.width * dpr;
      canvas.height = layout.height * dpr;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderBoard(ctx, layout, data);

    const took = performance.now() - started;
    if (took > FRAME_BUDGET_MS) console.warn(`Board render took ${took.toFixed(1)} ms`);
  }
}
```

**Що тут важливо:**

- **`input.required()` і `viewChild.required()`** — сучасне signal-based API замість `@Input` і `@ViewChild`.
- **`effect` + `requestAnimationFrame` + `onCleanup`.** Якщо за один кадр (~16 мс) прийде кілька
  оновлень стану, `onCleanup` скасує попередній запит кадру. Тож намалюється лише останній стан,
  і жодної роботи "на смітник". Це і є робота з frame budget.
- **`devicePixelRatio`.** Буфер canvas робимо у `dpr` разів більшим за логічний розмір, інакше
  на щільних екранах цифри будуть розмиті.
- **Вимірювання часу рендеру.** Якщо кадр не вклався в 16 мс, у консолі з'явиться попередження.
  На слабкому залізі такі метрики — перше, на що дивляться.

## 2.6 Верхній екран, конфіг, маршрути

`src/app/pages/board-page.ts`

```ts
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BoardLayout } from '../../lib/board-renderer';
import { BoardCanvas } from '../board-canvas/board-canvas';
import { MatchSocket } from '../match-socket';

// Верхній екран пульта: дзеркало великого табло.
@Component({
  selector: 'app-board-page',
  imports: [BoardCanvas],
  template: `
    @if (layout(); as layout) {
      @if (socket.state(); as state) {
        <app-board-canvas [layout]="layout" [data]="state" />
      }
    }
    @if (socket.status() !== 'open') {
      <div class="offline">NO LINK · reconnecting…</div>
    }
  `,
  styles: `
    :host { display: block; position: relative; }
    .offline {
      position: absolute; inset: auto 0 0 0; padding: 6px;
      background: #b00020; color: #fff; font: bold 14px system-ui; text-align: center;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardPage {
  protected readonly socket = inject(MatchSocket);
  // Layout — це просто JSON. Інший вид спорту = інший файл, без зміни коду.
  protected readonly layout = toSignal(inject(HttpClient).get<BoardLayout>('layouts/basketball.json'));
}
```

`src/app/app.config.ts`

```ts
import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(routes), provideHttpClient(withFetch())],
};
```

`src/app/app.ts`

```ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App {}
```

`src/styles.css`

```css
html, body { margin: 0; background: #000; }
```

`src/app/app.routes.ts` (тут уже всі три сторінки; `control` і `console` створимо в день 3,
тож поки що закоментуйте ці два рядки, а редірект направте на `board`):

```ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'board', loadComponent: () => import('./pages/board-page').then((m) => m.BoardPage) },
  { path: 'control', loadComponent: () => import('./pages/control-page').then((m) => m.ControlPage) },
  { path: 'console', loadComponent: () => import('./pages/console-page').then((m) => m.ConsolePage) },
  { path: '', pathMatch: 'full', redirectTo: 'console' },
];
```

Запуск (сервер з дня 1 має працювати):

```bash
npm start
```

Відкрийте http://localhost:4200/board. Ви маєте побачити табло зі станом із сервера.

**Перевірте поведінку при збоях:**

1. Зупиніть сервер: має з'явитися червона смуга `NO LINK · reconnecting…`, а останній стан лишається на екрані.
2. Запустіть сервер знову: смуга зникне сама, без перезавантаження сторінки.
3. Відкрийте DevTools → Network → WS і подивіться повідомлення `hello` / `state` у реальному часі.

### ✅ Кінець дня 2. Ви можете пояснити:

- чому рендерер — окрема бібліотека без Angular і як JSON-схема відокремлює вигляд від коду;
- різницю між `retry` і `repeat` для WebSocket;
- як `scan` + `seq` гарантують правильний порядок стану;
- чому команди офлайн не буферизуються;
- як `effect` + `requestAnimationFrame` + `onCleanup` вкладаються в кадровий бюджет.

---

# День 3 — Кнопки, kiosk, тести і історія для співбесіди

## 3.1 Нижній екран: що зараз робить кожна кнопка

`src/app/pages/control-page.ts`

```ts
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatchSocket } from '../match-socket';
import { Command, Team } from '../protocol';

type Mode = 'game' | 'more';

interface SoftKey {
  label: string;
  command?: Command;
  mode?: Mode;
}

const LED_FLASH_MS = 150;
const score = (team: Team, delta: number): Command => ({ type: 'score', team, delta });
const foul = (team: Team, delta: number): Command => ({ type: 'foul', team, delta });

// Нижній екран пульта: що зараз робить кожна з 8 фізичних кнопок.
// Кнопки емулюємо клавішами 1–8 (H — сирена, P — наступний період, Shift+R — скидання).
@Component({
  selector: 'app-control-page',
  template: `
    <div class="mode">MODE: {{ mode() === 'game' ? 'GAME' : 'FOULS / CORRECTIONS' }}</div>
    <div class="keys">
      @for (key of keys(); track $index) {
        <button class="key" [class.lit]="lit() === $index" [class.disabled]="socket.status() !== 'open' && !key.mode" (click)="press($index)">
          <span class="num">{{ $index + 1 }}</span>
          <span class="label">{{ key.label }}</span>
        </button>
      }
    </div>
    <div class="hint">H horn · P next period · Shift+R reset</div>
  `,
  styles: `
    :host { display: block; background: #111; color: #eee; padding: 10px; font-family: system-ui, sans-serif; }
    .mode { font-size: 13px; letter-spacing: .1em; color: #8ab4f8; margin-bottom: 8px; }
    .keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .key {
      position: relative; height: 64px; border: 1px solid #333; border-radius: 6px;
      background: #1c1c1e; color: inherit; font: bold 15px system-ui; white-space: pre-line; cursor: pointer;
    }
    .key.lit { background: #ffcc00; color: #000; }
    .key.disabled { opacity: .35; }
    .num { position: absolute; top: 4px; left: 6px; font-size: 10px; opacity: .6; }
    .hint { margin-top: 8px; font-size: 11px; opacity: .5; }
  `,
  host: { '(document:keydown)': 'onKey($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ControlPage {
  protected readonly socket = inject(MatchSocket);
  protected readonly mode = signal<Mode>('game');
  protected readonly lit = signal<number | null>(null); // "світлодіод" натиснутої кнопки

  // Підписи кнопок залежать від режиму і від стану гри (START ↔ STOP).
  protected readonly keys = computed<SoftKey[]>(() => {
    const running = this.socket.state()?.clock.running ?? false;
    const clockKey: SoftKey = running
      ? { label: 'STOP\nCLOCK', command: { type: 'clock.stop' } }
      : { label: 'START\nCLOCK', command: { type: 'clock.start' } };

    if (this.mode() === 'game') {
      return [
        { label: 'HOME\n+1', command: score('home', 1) },
        { label: 'HOME\n+2', command: score('home', 2) },
        { label: 'HOME\n+3', command: score('home', 3) },
        clockKey,
        { label: 'GUEST\n+1', command: score('away', 1) },
        { label: 'GUEST\n+2', command: score('away', 2) },
        { label: 'GUEST\n+3', command: score('away', 3) },
        { label: 'MORE ▸', mode: 'more' },
      ];
    }
    return [
      { label: 'HOME\nFOUL +1', command: foul('home', 1) },
      { label: 'HOME\nFOUL −1', command: foul('home', -1) },
      { label: 'HOME\nSCORE −1', command: score('home', -1) },
      clockKey,
      { label: 'GUEST\nFOUL +1', command: foul('away', 1) },
      { label: 'GUEST\nFOUL −1', command: foul('away', -1) },
      { label: 'GUEST\nSCORE −1', command: score('away', -1) },
      { label: '◂ BACK', mode: 'game' },
    ];
  });

  private flashTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.flashTimer));
  }

  protected onKey(event: KeyboardEvent): void {
    // Утримана клавіша генерує автоповтор. Без цієї перевірки довге натискання "+3"
    // додало б 30 очок. На залізі те саме робить debounce кнопок.
    if (event.repeat) return;

    if (event.key >= '1' && event.key <= '8') this.press(Number(event.key) - 1);
    else if (event.key === 'h' || event.key === 'H') this.socket.send({ type: 'horn' });
    else if (event.key === 'p' || event.key === 'P') this.socket.send({ type: 'period.next' });
    else if (event.key === 'R' && event.shiftKey) this.socket.send({ type: 'reset' });
  }

  protected press(index: number): void {
    const key = this.keys()[index];
    if (!key) return;
    if (key.mode) {
      this.mode.set(key.mode);
    } else if (key.command && !this.socket.send(key.command)) {
      return; // немає зв'язку: кнопка не "світиться", оператор бачить, що натискання не пройшло
    }
    this.flash(index);
  }

  private flash(index: number): void {
    clearTimeout(this.flashTimer);
    this.lit.set(index);
    this.flashTimer = setTimeout(() => this.lit.set(null), LED_FLASH_MS);
  }
}
```

**Що тут важливо:**

- **`computed` для підписів.** Підписи залежать від двох сигналів: режиму (`mode`) і стану гри
  (`running`). Кнопка 4 сама змінює `START CLOCK` ↔ `STOP CLOCK`. Це буквально пункт вакансії
  *"the bottom one shows what each button currently does"*.
- **Режими (shift).** 8 кнопок, але дій більше: кнопка 8 перемикає сторінку. На справжньому
  пульті з ~30 кнопками це так само.
- **`event.repeat`.** Утримана клавіша генерує автоповтор, і без перевірки одне довге натискання
  "+3" додало б 30 очок. На залізі аналогічну проблему вирішує debounce. Про це варто домовитися з
  embedded-командою: хто відповідає за debounce і утримання кнопки.
- **"LED"-підсвітка** після успішного натискання. Немає зв'язку — немає підсвітки, і оператор
  бачить, що натискання не пройшло.
- **`DestroyRef.onDestroy`** прибирає таймер підсвітки. Маленький, але показовий teardown.
- `host: { '(document:keydown)': ... }` — сучасна заміна `@HostListener`.

## 3.2 Режим розробки: обидва екрани разом

`src/app/pages/console-page.ts`

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BoardPage } from './board-page';
import { ControlPage } from './control-page';

// Лише для розробки: обидва екрани пульта один під одним, як на справжньому пристрої.
// На залізі це були б два окремі kiosk-вікна: /board і /control.
@Component({
  selector: 'app-console-page',
  imports: [BoardPage, ControlPage],
  template: `
    <div class="device">
      <app-board-page />
      <app-control-page />
    </div>
  `,
  styles: `
    .device {
      max-width: 640px; margin: 24px auto; border: 12px solid #2a2a2a; border-radius: 16px;
      overflow: hidden; box-shadow: 0 10px 40px #0008;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsolePage {}
```

Розкоментуйте маршрути `control` і `console` в `app.routes.ts` і поверніть редірект на `console`.
Відкрийте http://localhost:4200/console.

**Сценарії для перевірки:**

| Дія | Очікування |
|---|---|
| `4` | Годинник пішов, кнопка 4 стала `STOP CLOCK` |
| `1`, `2`, `3` | +1, +2, +3 господарям, кнопка коротко світиться жовтим |
| Затиснути `3` | Додається лише 3 очки, а не 30 |
| `8`, потім `1` | Режим FOULS, фол господарям |
| `H` | Індикатор HORN світиться 2 секунди |
| `P` | Наступний період, годинник 10:00, фоли обнулено |
| Вбити сервер (`taskkill /F`) | Банер NO LINK, кнопки пригашені, натискання не проходять |
| Запустити сервер | Клієнт підключився сам, стан відновлено, годинник на паузі |
| Відкрити `/board` у другій вкладці | Обидві вкладки синхронні: так два екрани пульта отримують один стан |

## 3.3 Тест рендерера

`src/lib/board-renderer/render-board.spec.ts`

```ts
import { formatClock, resolve } from './render-board';

describe('formatClock', () => {
  it('shows MM:SS from one minute up, rounding seconds up', () => {
    expect(formatClock(600_000)).toBe('10:00');
    expect(formatClock(599_900)).toBe('10:00');
    expect(formatClock(599_000)).toBe(' 9:59');
    expect(formatClock(60_000)).toBe(' 1:00');
  });

  it('shows SS.t during the last minute', () => {
    expect(formatClock(59_999)).toBe('59.9');
    expect(formatClock(5_340)).toBe(' 5.3');
    expect(formatClock(0)).toBe(' 0.0');
  });
});

describe('resolve', () => {
  it('reads nested values by dotted path', () => {
    const data = { home: { score: 42 }, horn: true };
    expect(resolve(data, 'home.score')).toBe(42);
    expect(resolve(data, 'horn')).toBe(true);
    expect(resolve(data, 'away.score')).toBeUndefined();
  });
});
```

```bash
npx ng test --watch=false
```

> В Angular 21 тест-раннер за замовчуванням — Vitest, а API (`describe`, `it`, `expect`)
> таке саме, як у Jest.

## 3.4 Kiosk mode на вашому ПК

Закрийте Chrome повністю, або використайте окремий профіль, як нижче:

```bash
start chrome --kiosk --user-data-dir=%TEMP%\kiosk-profile http://localhost:4200/board
```

(Це команда для `cmd`. У PowerShell: `Start-Process chrome '--kiosk','--user-data-dir=C:\Temp\kiosk','http://localhost:4200/board'`.)

Вийти з kiosk-вікна: `Alt+F4`. Ось так виглядатиме верхній екран пульта: ні адресного рядка, ні вкладок.
На пристрої це робить systemd-сервіс, який при старті запускає `chromium --kiosk ...`.

## 3.5 Якщо лишився час: додаткові завдання

Кожне з них — готова історія для співбесіди:

1. **Хокейне табло.** `layouts/hockey.json` з іншим розміщенням: перевірка, що рендерер справді універсальний.
2. **Shot clock (24 секунди).** Другий годинник у стані, нова команда, новий елемент у layout.
3. **Еволюція протоколу.** Додайте в `MatchState` нове поле (`possession: 'home' | 'away'`), не змінюючи
   `PROTOCOL_VERSION`. Переконайтеся, що старий клієнт (без підтримки поля) працює далі. Поясніть,
   коли версію *треба* збільшувати: коли зміна ламає старих клієнтів.
4. **Перемальовувати лише змінене.** Зараз щокадру малюється все табло. Оптимізуйте: перемальовуйте
   тільки елементи, чиї значення змінилися (dirty rectangles).
5. **Linux + SSH.** Запустіть сервер у WSL (Ubuntu) або на Raspberry Pi, підключіться по SSH,
   подивіться логи через `journalctl` (якщо оформите як systemd-сервіс) або `tail -f`.
6. **GitHub.** Викладіть проєкт у публічний репозиторій з README і скріншотом. Посилання можна дати
   рекрутеру або показати на технічній співбесіді.

## 3.6 Як розповісти про проєкт на співбесіді

Коротка версія (англійською, ~1 хв):

> *"To prepare for this role, I built a small model of the operator console. A NestJS service on the
> 'device' holds the match state and the game clock and pushes full snapshots over a plain WebSocket.
> Every message has a sequence number, so clients drop stale updates. On connect, the server sends a
> hello with the full state, so reconnection is trivial. State is persisted with an atomic
> write-fsync-rename, so if you hard-kill the process mid-game, it comes back with the same score and
> the clock paused. The clock is persisted at most once a second to save flash.*
>
> *On the client, there are two Angular 21 zoneless apps — the board mirror and the soft-key display.
> The board is drawn by a framework-free TypeScript library that renders seven-segment digits on canvas
> from a JSON layout. The WebSocket layer is RxJS with exponential-backoff reconnection and is exposed as
> signals; rendering is coalesced with requestAnimationFrame so it stays within the frame budget."*

### Ймовірні технічні питання і короткі відповіді

| Питання | Суть відповіді |
|---|---|
| Як уникнути витоків підписок в Angular? | `toSignal`, `async` pipe, `takeUntilDestroyed`, `DestroyRef`; не робити ручний `subscribe` без teardown |
| Signals чи RxJS? | Signals — для стану, який читає шаблон. RxJS — для подій у часі: WebSocket, retry, debounce. Міст між ними: `toSignal` / `toObservable` |
| `switchMap` vs `mergeMap` vs `concatMap` vs `exhaustMap` | Скасувати попереднє / паралельно / по черзі / ігнорувати нове, поки йде попереднє |
| Як зробити перепідключення WebSocket? | `retry` з backoff + `repeat` для штатного закриття; повний стан у `hello` після підключення |
| Як гарантувати порядок повідомлень? | Номер `seq` від сервера; клієнт відкидає старіші |
| Як не зламати старих клієнтів при зміні протоколу? | Лише додавати поля, tolerant reader на обох кінцях, версія в handshake, змінювати major тільки при breaking change |
| Canvas чи SVG? | Canvas: багато елементів, часті оновлення, повний контроль над кадром. SVG: мало елементів, DOM-події, доступність, масштабування |
| Як не вийти з frame budget? | `requestAnimationFrame`, малювати лише при зміні, не створювати об'єкти в гарячому циклі, перемальовувати лише змінене, кешувати статичний фон в offscreen canvas |
| Як пережити втрату живлення? | Атомарний запис (tmp + fsync + rename), обмеження частоти записів на флеш, безпечне відновлення (годинник на паузі) |
| Чим NestJS схожий на Angular / Spring? | Модулі, DI, декоратори, провайдери, lifecycle-хуки |
| Як дебажити на віддаленому Linux-пристрої? | `ssh`, `journalctl -u service -f`, `scp` для логів, `node --inspect` + SSH-тунель для Chrome DevTools |

---

## Якщо щось не працює

- **Клієнт показує NO LINK і не підключається.** Чи запущено сервер на порту 3000? Чи немає двох
  серверів одночасно (`EADDRINUSE` у логах)?
- **`ng build` / `ng serve` падає із `Segmentation fault`.** Вимкніть кеш збірки: `npx ng cache disable`.
  (У готовому проєкті кеш уже вимкнено, бо це знадобилося в середовищі, де його перевіряли.)
- **Помилки WebSocket у консолі браузера, поки сервер вимкнений** — це нормально: так виглядають
  спроби перепідключення.
- **`EADDRINUSE: address already in use :::3000`** означає, що попередній сервер ще працює.
  Знайдіть його PID: `netstat -ano | findstr :3000`, потім `taskkill /F /PID <pid>`.

Успіхів на співбесіді! 🍀
