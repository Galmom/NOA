from pathlib import Path
import struct, sys
from PIL import Image, ImageDraw

ROOT = Path(r"C:\Users\lord_\Downloads\NOA\firmware\managed_components\espressif2022__esp_emote_assets\emoji_large")
OUT = Path(r"C:\Users\lord_\Downloads\NOA\EAF_EXTRAIDOS")
MAGIC = b"\x89EAF"
TABLE_OFFSET = 16
ENTRY_SIZE = 8


def u16(b, p): return struct.unpack_from('<H', b, p)[0]
def u32(b, p): return struct.unpack_from('<I', b, p)[0]


def parse_entries(data):
    if len(data) < TABLE_OFFSET or data[:4] != MAGIC:
        raise ValueError('Cabecera EAF inválida')
    count = u32(data, 4)
    if count <= 0 or count > 10000:
        raise ValueError(f'Cantidad de frames sospechosa: {count}')
    table_end = TABLE_OFFSET + count * ENTRY_SIZE
    if table_end > len(data):
        raise ValueError('Tabla de frames fuera del archivo')
    candidates = []
    for size_first in (True, False):
        entries, valid = [], True
        for i in range(count):
            a, b = struct.unpack_from('<II', data, TABLE_OFFSET + i * ENTRY_SIZE)
            size, offset = (a, b) if size_first else (b, a)
            start = table_end + offset
            end = start + size
            if size < 4 or start < table_end or end > len(data) or data[start:start+2] != b'ZZ':
                valid = False
                break
            entries.append((start, size))
        if valid:
            candidates.append(entries)
    if len(candidates) != 1:
        raise ValueError('No pude identificar de forma inequívoca el orden size/offset de la tabla')
    return candidates[0]


def decode_rle(src, expected_max):
    if len(src) % 2:
        raise ValueError('RLE con cantidad impar de bytes')
    out = bytearray()
    for i in range(0, len(src), 2):
        count, value = src[i], src[i+1]
        if len(out) + count > expected_max:
            raise ValueError('RLE excede el tamaño esperado del bloque')
        out.extend(bytes([value]) * count)
    return out


def decode_frame(frame):
    # El firmware quita los dos bytes ZZ antes de interpretar el frame.
    f = frame[2:]
    if f[:2] != b'_S':
        return None
    if len(f) < 18:
        raise ValueError('Header _S incompleto')
    depth = f[9]
    width, height, blocks, block_h = struct.unpack_from('<HHHH', f, 10)
    if depth != 8:
        raise ValueError(f'Profundidad no soportada por este extractor: {depth}')
    if not width or not height or not blocks or not block_h:
        raise ValueError('Dimensiones/bloques inválidos')
    if blocks > 64 or width * height > 2_000_000:
        raise ValueError('Dimensiones sospechosas')
    lengths_pos = 18
    lengths_end = lengths_pos + blocks * 4
    palette_end = lengths_end + 256 * 4
    if palette_end > len(f):
        raise ValueError('Tabla de bloques/paleta incompleta')
    lengths = list(struct.unpack_from('<' + 'I'*blocks, f, lengths_pos))
    palette = f[lengths_end:palette_end]
    pos = palette_end
    indices = bytearray(width * height)
    for block_no, block_len in enumerate(lengths):
        end = pos + block_len
        if block_len < 1 or end > len(f):
            raise ValueError(f'Bloque {block_no}: longitud fuera del frame')
        block = f[pos:end]
        pos = end
        encoding = block[0]
        if encoding != 0:
            raise ValueError(f'Bloque {block_no}: encoding {encoding}, esperaba RLE=0')
        rows = min(block_h, height - block_no * block_h)
        valid_pixels = width * rows
        max_pixels = width * block_h
        decoded = decode_rle(block[1:], max_pixels)
        if len(decoded) < valid_pixels:
            raise ValueError(f'Bloque {block_no}: RLE produjo {len(decoded)} bytes, se necesitan {valid_pixels}')
        start = block_no * width * block_h
        indices[start:start+valid_pixels] = decoded[:valid_pixels]
    rgba = bytearray(width * height * 4)
    for i, idx in enumerate(indices):
        p = idx * 4
        b, g, r, a = palette[p:p+4]
        q = i * 4
        if b == 0 and g == 0 and r == 0 and a == 0:
            rgba[q:q+4] = b'\x00\x00\x00\x00'
        else:
            rgba[q:q+4] = bytes((r, g, b, 255))
    return Image.frombytes('RGBA', (width, height), bytes(rgba))


def main():
    if not ROOT.is_dir():
        raise SystemExit(f'No encuentro la carpeta de assets: {ROOT}')
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(ROOT.glob('*.eaf'))
    if not files:
        raise SystemExit(f'No hay archivos .eaf en {ROOT}')
    summary = []
    for path in files:
        try:
            data = path.read_bytes()
            entries = parse_entries(data)
            frames = []
            for start, size in entries:
                img = decode_frame(data[start:start+size])
                if img is not None:
                    frames.append(img)
            if not frames:
                print(f'[OMITIDO] {path.name}: no contiene frames _S')
                continue
            folder = OUT / path.stem
            folder.mkdir(parents=True, exist_ok=True)
            for i, img in enumerate(frames):
                img.save(folder / f'frame_{i:03d}.png')
            frames[0].save(OUT / f'{path.stem}.gif', save_all=True,
                           append_images=frames[1:], duration=50, loop=0,
                           disposal=2, optimize=False)
            # Hoja de contacto: todos los frames, miniaturas en una grilla.
            thumb_w, thumb_h = 125, 160
            cols = 6
            rows = (len(frames) + cols - 1) // cols
            sheet = Image.new('RGB', (cols * thumb_w, rows * (thumb_h + 22)), (32, 32, 32))
            draw = ImageDraw.Draw(sheet)
            for i, img in enumerate(frames):
                thumb = img.convert('RGBA')
                x, y = (i % cols) * thumb_w, (i // cols) * (thumb_h + 22)
                bg = Image.new('RGBA', thumb.size, (32, 32, 32, 255))
                bg.alpha_composite(thumb)
                sheet.paste(bg.convert('RGB'), (x, y))
                draw.text((x + 4, y + thumb_h + 3), str(i), fill=(255, 255, 255))
            sheet.save(OUT / f'{path.stem}_contacto.jpg', quality=90)
            summary.append((path.name, len(entries), len(frames), frames[0].size))
            print(f'[OK] {path.name}: {len(frames)} frames de imagen, {frames[0].size[0]}x{frames[0].size[1]}')
        except Exception as exc:
            print(f'[ERROR] {path.name}: {exc}')
    print('\nSalida:', OUT)
    print('\nResumen:')
    for name, total, images, size in summary:
        print(f'  {name}: tabla={total}, imagenes={images}, tamaño={size[0]}x{size[1]}')

if __name__ == '__main__':
    main()
