#!/usr/bin/env python3
"""Erzeugt die App-Icons (PNG) für den Wochenplaner ohne externe Bibliotheken.

Gezeichnet wird ein abgerundetes Quadrat mit Indigo→Violett-Verlauf und drei
"Aufgaben-Balken" abnehmender Länge – der oberste (wichtigste) leuchtet am
hellsten. Ausgabe: icons/icon-192.png, icon-512.png, apple-touch-icon.png
"""
import zlib
import struct
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "icons")


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def rounded_alpha(x, y, w, h, radius):
    """Alpha (0..1) für ein abgerundetes Quadrat mit Anti-Aliasing."""
    rx = min(x, w - 1 - x)
    ry = min(y, h - 1 - y)
    if rx >= radius or ry >= radius:
        return 1.0
    dx = radius - rx
    dy = radius - ry
    dist = (dx * dx + dy * dy) ** 0.5
    edge = dist - radius
    if edge <= -1:
        return 1.0
    if edge >= 1:
        return 0.0
    return max(0.0, min(1.0, (1 - edge) / 2 + 0.5))


def draw(size):
    top = (99, 102, 241)      # Indigo  #6366f1
    bottom = (139, 92, 246)   # Violett #8b5cf6
    radius = int(size * 0.22)
    buf = bytearray()

    # Drei Aufgaben-Balken (relativ zur Größe)
    bars = [
        (0.55, 0.66, (255, 255, 255), 1.00),   # oberster, hellster (Priorität)
        (0.55, 0.45, (255, 255, 255), 0.55),
        (0.55, 0.24, (255, 255, 255), 0.32),
    ]
    bar_x = size * 0.22
    bar_h = size * 0.085
    bar_r = bar_h / 2
    first_cy = size * 0.34
    gap = size * 0.20

    for y in range(size):
        buf.append(0)  # PNG filter-byte (none)
        for x in range(size):
            t = y / max(1, size - 1)
            r, g, b = mix(top, bottom, t)
            a = rounded_alpha(x, y, size, size, radius)

            for i, (xr, _wr, col, op) in enumerate(bars):
                cy = first_cy + i * gap
                bw = size * (0.30 + 0.12 * (len(bars) - 1 - i))
                if abs(y - cy) <= bar_h / 2:
                    # horizontale Rundung an den Balkenenden
                    left = bar_x
                    right = bar_x + bw
                    inside = left <= x <= right
                    if inside:
                        # vertikale Kanten-Glättung
                        dyb = abs(y - cy)
                        edge_a = 1.0
                        if dyb > bar_h / 2 - 1:
                            edge_a = max(0.0, bar_h / 2 - dyb)
                        r = int(lerp(r, col[0], op * edge_a))
                        g = int(lerp(g, col[1], op * edge_a))
                        b = int(lerp(b, col[2], op * edge_a))

            clamp = lambda v: max(0, min(255, int(v)))
            buf.extend((clamp(r), clamp(g), clamp(b), clamp(a * 255)))

    return png_bytes(size, size, buf)


def png_bytes(w, h, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
        with open(os.path.join(OUT_DIR, name), "wb") as f:
            f.write(draw(size))
        print("geschrieben:", name)


if __name__ == "__main__":
    main()
