#!/usr/bin/env python3
"""
Cria um arquivo .ico (Windows icon) a partir de múltiplos PNGs.
Sem dependências externas — usa só stdlib do Python.

ICO format suporta PNGs embarcados desde Windows Vista, então
não precisamos converter pra BMP (que perde qualidade no alpha).

Uso:
    ./png-to-ico.py img1.png img2.png img3.png > out.ico
"""

import sys
import struct
from pathlib import Path

def make_ico(png_paths):
    pngs = []
    for p in png_paths:
        data = Path(p).read_bytes()
        # Pega largura/altura do header PNG (bytes 16-23)
        w, h = struct.unpack('>II', data[16:24])
        if w > 255: w = 0   # 0 = 256 no ICO format
        if h > 255: h = 0
        pngs.append((w, h, data))

    # ICO HEADER (6 bytes): reserved(2) + type(2) + count(2)
    out = struct.pack('<HHH', 0, 1, len(pngs))

    # ICON DIRECTORY ENTRIES (16 bytes cada)
    offset = 6 + 16 * len(pngs)
    for w, h, data in pngs:
        out += struct.pack(
            '<BBBBHHII',
            w & 0xFF,        # width  (0 = 256)
            h & 0xFF,        # height (0 = 256)
            0,               # color palette
            0,               # reserved
            1,               # color planes
            32,              # bits per pixel
            len(data),       # image size
            offset,          # offset
        )
        offset += len(data)

    # PIXEL DATA
    for _, _, data in pngs:
        out += data

    return out

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.stderr.write('uso: png-to-ico.py img1.png [img2.png ...]\n')
        sys.exit(1)
    sys.stdout.buffer.write(make_ico(sys.argv[1:]))
