const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/ws');
ws.on('open', () => {
  ws.send('not json at all');
  ws.send(JSON.stringify({ event: 'command', data: { type: 'self-destruct' } }));
  ws.send(JSON.stringify({ event: 'command', data: { type: 'score', team: 'home', delta: 3 } }));
  ws.send(JSON.stringify({ event: 'command', data: { type: 'clock.start' } }));
});
let n = 0;
ws.on('message', (m) => { const msg = JSON.parse(m); if (n++ < 4 || msg.state.horn) console.log(msg.type, msg.seq, JSON.stringify(msg.state.home), JSON.stringify(msg.state.clock), 'horn', msg.state.horn); });
setTimeout(() => { console.log('total msgs', n); ws.close(); }, 4000);
