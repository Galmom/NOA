// Targeted extraction: full-length MCP tool strings from the merged image.
// Runs are collected as raw bytes so UTF-8 accents (hábito) never split a string.
import { readFileSync, writeFileSync } from 'node:fs';

const BIN = 'C:\\Users\\lord_\\Downloads\\troko-firmware-es\\troko-wk-esp32s3-dev-es.bin';
const OUT = 'C:\\Users\\lord_\\Downloads\\NOA\\spec\\MCP-TOOLS.txt';
const MIN = 60;
const MAX = 4000;

const buf = readFileSync(BIN);
const KW = /habit|tarea|\btask|recordatorio|reminder|alarma|alarm|pomodoro|temporizador|\btimer|telegram|animaci|ALWAYS call|camera|brightness|volume|snapshot|preview|theme|wake_only/i;

const found = new Set();

function push(bytes) {
  if (bytes.length < MIN) return;
  const s = Buffer.from(bytes).toString('utf8');
  if (s.includes('\uFFFD')) return;
  if (!KW.test(s)) return;
  found.add(s);
}

// UTF-8 / ASCII
let cur = [];
for (let i = 0; i < buf.length; i++) {
  const b = buf[i];
  if (b >= 0x20 && b !== 0x7f) {
    if (cur.length < MAX) cur.push(b);
  } else {
    push(cur);
    cur = [];
  }
}
push(cur);

// UTF-16LE
let w = '';
for (let i = 0; i + 1 < buf.length; i += 2) {
  const ch = buf[i] | (buf[i + 1] << 8);
  const printable = ch >= 0x20 && ch !== 0x7f;
  if (printable) {
    if (w.length < MAX) w += String.fromCharCode(ch);
  } else {
    if (w.length >= MIN && KW.test(w)) found.add(w);
    w = '';
  }
}

const lines = [...found].sort((a, b) => a.length - b.length);
writeFileSync(OUT, lines.join('\r\n'), 'utf8');
console.log(`strings: ${lines.length}`);
for (const s of lines) console.log(`${String(s.length).padStart(4)}  ${s.slice(0, 90)}`);
