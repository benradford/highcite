#!/usr/bin/env python3
"""
Generate HighCite PNG icons using only Python stdlib (no Pillow required).
Run once: python3 create_icons.py
"""
import struct, zlib, os

def make_png(width, height, pixels):
    """Build a minimal valid PNG from a list of (r,g,b,a) tuples, row-major."""
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter type None
        for x in range(width):
            r, g, b, a = pixels[y * width + x]
            raw += bytes([r, g, b, a])

    def chunk(name, data):
        crc = zlib.crc32(name + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', crc)

    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # RGBA
    idat_data = zlib.compress(raw)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr_data)
        + chunk(b'IDAT', idat_data)
        + chunk(b'IEND', b'')
    )

def draw_icon(size):
    """Draw a blue rounded-square icon with a white quotation mark."""
    pixels = []
    cx, cy = size / 2, size / 2
    r_outer = size / 2
    r_inner = size / 2 - max(1, size // 8)  # corner radius approximation

    # Colors
    BG      = (59, 130, 246, 255)   # #3b82f6 blue
    WHITE   = (255, 255, 255, 255)
    TRANSP  = (0, 0, 0, 0)

    # Rounded rect mask: pixel is inside if within a rounded square
    def in_rounded_rect(x, y):
        corner = size * 0.22
        dx = max(0.0, abs(x - cx) - (r_outer - corner))
        dy = max(0.0, abs(y - cy) - (r_outer - corner))
        return dx * dx + dy * dy <= corner * corner

    # Simple quotation mark: two small filled circles + descenders
    def in_quote(x, y):
        # Two circular blobs in upper third, roughly centered
        dot_r  = size * 0.10
        left_x = cx - size * 0.14
        right_x = cx + size * 0.14
        top_y  = cy - size * 0.18

        def in_glyph_dot(px, py, ox, oy):
            return (px - ox)**2 + (py - oy)**2 <= dot_r**2

        def in_glyph_tail(px, py, ox, oy):
            # small downward tail
            return (abs(px - ox) <= dot_r * 0.55 and
                    oy < py <= oy + size * 0.18)

        return (in_glyph_dot(x, y, left_x, top_y) or
                in_glyph_dot(x, y, right_x, top_y) or
                in_glyph_tail(x, y, left_x, top_y) or
                in_glyph_tail(x, y, right_x, top_y))

    for row in range(size):
        for col in range(size):
            # Use pixel center
            px, py = col + 0.5, row + 0.5
            if in_rounded_rect(px, py):
                if in_quote(px, py):
                    pixels.append(WHITE)
                else:
                    pixels.append(BG)
            else:
                pixels.append(TRANSP)

    return make_png(size, size, pixels)


os.makedirs('icons', exist_ok=True)
for sz in [16, 48, 128]:
    data = draw_icon(sz)
    path = f'icons/icon{sz}.png'
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Created {path} ({len(data)} bytes)')

print('Done. Load the extension in Chrome via chrome://extensions → Load unpacked.')
