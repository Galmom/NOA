// Read-only forensic dump of a merged ESP32-S3 flash image.
// Produces: partition map, app descriptor, and a categorised string report.
import { readFileSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';

const BIN = 'C:\\Users\\lord_\\Downloads\\troko-firmware-es\\troko-wk-esp32s3-dev-es.bin';
const OUT = 'C:\\Users\\lord_\\Downloads\\troko-firmware-es';
const MAX_LEN = 200;
const MAX_STRINGS = 120000;

const buf = readFileSync(BIN);
const lines = [];
const say = (s = '') => lines.push(s);

say('TROKO / XIAOZHI FIRMWARE - MAPA DEL .BIN');
say('=========================================');
say(`Archivo: ${BIN}`);
say(`Tamaño: ${buf.length} bytes (${(buf.length / 1048576).toFixed(2)} MB)`);
say('');

const PART_TYPES = { 0: 'app', 1: 'data' };
const APP_SUBTYPES = { 0: 'factory', 16: 'ota_0', 17: 'ota_1', 32: 'test' };
const DATA_SUBTYPES = {
  0: 'ota', 1: 'phy', 2: 'nvs', 3: 'coredump', 4: 'nvs_keys', 5: 'efuse',
  6: 'undefined', 128: 'esphttpd', 129: 'fat', 130: 'spiffs', 131: 'littlefs',
};

function label(raw) {
  let s = '';
  for (let i = 0; i < 16; i++) {
    const c = raw[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

say('TABLA DE PARTICIONES (offset 0x8000)');
say('------------------------------------');
say('  #  tipo   subtipo     offset      tamaño       label');
const parts = [];
for (let i = 0; i < 95; i++) {
  const at = 0x8000 + i * 32;
  if (buf[at] !== 0xaa || buf[at + 1] !== 0x50) break;
  const type = buf[at + 2];
  const sub = buf[at + 3];
  const off = buf.readUInt32LE(at + 4);
  const size = buf.readUInt32LE(at + 8);
  const name = label(buf.subarray(at + 12, at + 28));
  const typeName = PART_TYPES[type] ?? String(type);
  const subName = type === 0
    ? (APP_SUBTYPES[sub] ?? String(sub))
    : (DATA_SUBTYPES[sub] ?? String(sub));
  parts.push({ type, sub, off, size, name });
  say(
    `  ${String(i).padStart(2)} ${typeName.padEnd(6)} ${subName.padEnd(11)} 0x${off.toString(16).padEnd(8)} 0x${size.toString(16).padEnd(10)} ${name}`,
  );
}
say('');

function appDesc(offset) {
  if (offset + 0x120 > buf.length) return null;
  const magic = buf.readUInt32LE(offset + 0x20);
  if (magic !== 0xabcd5432) return null;
  const str = (at, n) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = buf[at + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  return {
    version: str(offset + 0x30, 32),
    project: str(offset + 0x50, 32),
    time: str(offset + 0x70, 16),
    date: str(offset + 0x80, 16),
    idf: str(offset + 0x90, 32),
  };
}

say('APLICACIONES');
say('-------------');
for (const p of parts.filter((x) => x.type === 0)) {
  const d = appDesc(p.off);
  if (!d) {
    say(`  ${p.name}: sin esp_app_desc válido`);
    continue;
  }
  say(`  ${p.name}`);
  say(`    proyecto : ${d.project}`);
  say(`    version  : ${d.version}`);
  say(`    compilado: ${d.date} ${d.time}`);
  say(`    ESP-IDF  : ${d.idf}`);
}
say('');

// ── Strings, O(n), capped ─────────────────────────────────────────────────
const seen = new Set();
const ascii = [];
const wide = [];

function add(list, s) {
  if (s.length < 6 || seen.has(s)) return;
  seen.add(s);
  list.push(s);
}

let run = '';
for (let i = 0; i < buf.length; i++) {
  const b = buf[i];
  if (b >= 0x20 && b <= 0x7e) {
    if (run.length < MAX_LEN) run += String.fromCharCode(b);
  } else {
    if (run.length >= 6) add(ascii, run);
    run = '';
    if (seen.size > MAX_STRINGS) break;
  }
}
if (run.length >= 6) add(ascii, run);

let wrun = '';
for (let i = 0; i + 1 < buf.length; i += 2) {
  const ch = buf[i] | (buf[i + 1] << 8);
  const printable = ch >= 0x20 && ch !== 0x7f && !(ch >= 0x80 && ch < 0xa0);
  if (printable) {
    if (wrun.length < MAX_LEN) wrun += String.fromCharCode(ch);
  } else {
    if (wrun.length >= 6) add(wide, wrun);
    wrun = '';
    if (seen.size > MAX_STRINGS) break;
  }
}

say(`STRINGS UNICOS: ${ascii.length} ASCII, ${wide.length} UTF-16LE`);
say('');

const PATTERNS = [
  ['ENDPOINTS / URLs', /^(https?:\/\/|wss?:\/\/|mqtt:\/\/)/i],
  ['DOMINIOS / HOSTS', /(\.com|\.net|\.org|\.io|\.cn|\.me|\.dev)\b/i],
  ['OTA / VERSION', /(ota|firmware|version|upgrade)/i],
  ['BOARD / HARDWARE', /(esp32|esp-box|lcd|ili9|st77|gc9|display|touch|i2s|codec|es8311|es7210|xl9555|axp2101)/i],
  ['WIFI / PROVISIONING', /(ssid|wifi_prov|smartconfig|softap|blufi)/i],
  ['PROTOCOLO', /(mcp|websocket|opus|aec|vad|wake|kws|afe)/i],
  ['PANTALLA / OJOS', /(emoji|eye|face|anim|sprite|gif|jpg|png|lvgl)/i],
];

const grouped = new Map(PATTERNS.map(([n]) => [n, []]));
for (const s of ascii.concat(wide)) {
  for (const [name, re] of PATTERNS) {
    if (re.test(s)) { grouped.get(name).push(s); break; }
  }
}

for (const [name, list] of grouped) {
  if (list.length === 0) continue;
  say(`== ${name} (${list.length}) ==`);
  for (const s of list.slice(0, 50)) say(`   ${s.slice(0, 150)}`);
  if (list.length > 50) say(`   ... y ${list.length - 50} mas`);
  say('');
}

writeFileSync(`${OUT}\\TROKO-MAPA.txt`, lines.join('\r\n'), 'utf8');

// Full dump streamed, so a 16 MB image never has to fit in one string.
const all = ascii.concat(wide).sort();
const fd = openSync(`${OUT}\\TROKO-STRINGS.txt`, 'w');
writeSync(fd, '\uFEFF');
for (const s of all) writeSync(fd, s + '\r\n');
closeSync(fd);

console.log(`mapa: ${lines.length} lineas`);
console.log(`strings: ${all.length} unicos`);
