const WebSocket = require('ws');
const mode = process.argv[2];
const ws = new WebSocket('ws://localhost:3000/ws');
const cmd = (data) => ws.send(JSON.stringify({ event: 'command', data }));
ws.on('message', (m) => {
  const msg = JSON.parse(m);
  if (msg.type !== 'hello') return;
  console.log('hello:', JSON.stringify(msg.state));
  if (mode === 'play') {
    cmd({ type: 'score', team: 'home', delta: 2 });
    cmd({ type: 'score', team: 'away', delta: 3 });
    cmd({ type: 'foul', team: 'home', delta: 1 });
    cmd({ type: 'clock.start' });
  }
  setTimeout(() => process.exit(0), mode === 'play' ? 2500 : 100);
});
