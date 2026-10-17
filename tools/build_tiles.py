"""Seamless terrain textures cut from the reference (wrap by min-error cut + light flattening)."""
import os
import numpy as np
import cv2
from PIL import Image

from common import (ref_rgb, half, save, wrap_x, wrap_y, flatten_light, best_period, resize_rgba, TOOLS,
                    quilt, poly_mask, clean_mask, disk, flatten_lab)


def rgba(a):
    return np.dstack([a, np.full(a.shape[:2], 255, np.uint8)])


def tile_xy(src, size_full, ov=24, flat=None):
    """src: RGB full-res crop larger than size_full+ov in both axes."""
    if flat:
        src = flatten_light(src, flat)
    t = wrap_x(src[:size_full + ov], size_full, ov)
    t = wrap_y(t, size_full, ov)
    return t


def rain_mask(s):
    """Thin bright vertical rain streaks."""
    f = s.astype(np.float32).mean(-1)
    bg = cv2.blur(f, (7, 1))
    m = cv2.morphologyEx(((f - bg) > 14).astype(np.uint8), cv2.MORPH_OPEN, np.ones((9, 1), np.uint8))
    return cv2.dilate(m, np.ones((3, 3), np.uint8)).astype(bool)


def quilt_bricks(R, box, excl, seed):
    """Quilt a 256x256 (full-res) seamless brick texture from a clean sample, keeping brick rows aligned."""
    x0, y0, x1, y1 = box
    s = flatten_lab(R[y0:y1, x0:x1].copy(), 22, True, 0.85)
    per, _ = best_period(s, 24, 48, axis=0)
    Ht = round(256 / per) * per
    ok = ~rain_mask(s)
    for (a, b, c, d) in excl:
        ok[max(0, b - y0):d - y0, max(0, a - x0):c - x0] = False
    q = quilt(s, ok, (Ht + per, 256 + 28), block=48, ov=12, seed=seed, tol=0.05, align_y=per)
    q = wrap_y(wrap_x(q, 256, 28), Ht, per)
    return cv2.resize(q, (256, 256), interpolation=cv2.INTER_AREA)


def grade(t, gain, warm=(1.0, 1.0, 1.0), contrast=1.0):
    f = t.astype(np.float32)
    m = f.mean((0, 1), keepdims=True)
    f = (f - m) * contrast + m
    f = f * gain * np.array(warm, np.float32)
    return np.clip(f + 0.5, 0, 255).astype(np.uint8)


def build_brick(R):
    # warm brick wall lit by the sconce (band below the lamp; lamp & stray marks excluded)
    t = quilt_bricks(R, (285, 1990, 580, 2140), [(375, 1960, 425, 2015), (460, 1990, 480, 2040)], 3)
    t = grade(t, 1.35, (1.12, 1.0, 0.88), 1.25)
    return save("tile_brick.png", half(t))


def build_brick_dark(R):
    # cold dark bricks under the broken wall
    t = quilt_bricks(R, (700, 2015, 990, 2200), [(860, 2095, 1000, 2200), (770, 2010, 790, 2060)], 5)
    return save("tile_brick_dark.png", half(t))


def build_girder(R):
    # tall lattice column in the lower area (x 580-640) — period ~ 86/87 px vertically
    x0, x1 = 578, 646
    seg = R[1700:2340, x0:x1]
    p, _ = best_period(seg, 70, 140, axis=0)
    # use 2 periods so the tile is not too short; wrap with the min-cut
    H = 2 * p
    src = R[1720:1720 + H + 20, x0:x1]
    src = flatten_light(src, 25, 0.8)
    t = wrap_y(src, H, 20)
    t = (np.clip(t.astype(np.float32) * 1.3, 0, 255)).astype(np.uint8)
    return save("tile_girder_v.png", half(t)), p


def build_girder_x(R):
    """Extra: the big X-braced truss tower (center-right) with transparent gaps, vertical period 122."""
    x0, x1 = 874, 998
    p = 122
    y0 = 1010
    src = R[y0:y0 + p + 16, x0:x1].astype(int)
    warm = src[..., 0] - src[..., 2]
    lum = src.mean(-1)
    m = ((warm > -6) | (lum < 30)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, disk(1))
    m = clean_mask(m, 40)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, disk(1))
    rgba_ = np.dstack([src.astype(np.uint8), m * 255])
    t = wrap_y(rgba_, p, 16)
    return save("tile_girder_x.png", half(t))


def build_deck(R):
    # walkway: top surface y~1500 + truss strip down to ~1600; period of the X pattern ~ 85 px
    y0, y1 = 1500, 1612
    seg = R[y0:y1, 260:1040]
    p, _ = best_period(seg, 70, 120, axis=1)
    W = 3 * p
    # clean stretch between the left gargoyle pillar (x<270) and the hero's back foot (x>=553)
    xs = 272
    src = R[y0:y1, xs:xs + W + 24].copy()
    f = src.astype(np.float32).mean(-1)
    rain = ((f - cv2.blur(f, (9, 1))) > 10) & (src[..., 2].astype(int) - src[..., 0] > 15)
    rain = cv2.dilate(rain.astype(np.uint8), np.ones((5, 3), np.uint8))
    src = cv2.inpaint(src, rain, 3, cv2.INPAINT_TELEA)
    src = flatten_light(src, 30, 0.7)
    t = wrap_x(src, W, 24)
    return save("tile_deck.png", half(t)), p


def build_stairs(R):
    # a few steps of the right staircase (x 790-1040, y 2120-2360): one step period
    src = R[2150:2350, 820:1060]
    out = half(src)
    a = np.dstack([out[..., :3], np.full(out.shape[:2], 255, np.uint8)])
    return save("tile_stairs.png", a)


def mosaic(name, nx=3, ny=3, scale=1):
    im = np.array(Image.open(os.path.join(os.path.dirname(TOOLS), "assets", "game", name)))
    m = np.tile(im, (ny, nx, 1))
    return m


if __name__ == "__main__":
    R = ref_rgb()
    print(build_brick(R), build_brick_dark(R), build_girder(R), build_girder_x(R), build_deck(R), build_stairs(R))
