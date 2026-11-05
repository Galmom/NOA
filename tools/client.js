// Minimal client that speaks the same contract as the ESP32.
// Usage: node tools/test-client.js "hola wall-e"
const url = process.env.BRAIN_URL ?? 'ws://127.0.0.1:8765';
const text = process.argv.slice(2).join(' ') || 'hola wall-e';

const socket = new WebSocket(url);

const timer = setTimeout(() => {
  console.error('timeout waiting for reply');
  process.exit(1);
}, 20000);

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'text', text }));
});

socket.addEventListener('message', (event) => {
  clearTimeout(timer);
  console.log(event.data);
  socket.close();
  process.exit(0);
});

socket.addEventListener('error', (event) => {
  clearTimeout(timer);
  console.error('socket error:', event.message ?? 'unknown');
  process.exit(1);
});
