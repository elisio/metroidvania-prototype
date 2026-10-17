"""Background layers: bg_far (sky+city, hero/whip removed, mirror-tiled) and bg_mid (side structures with alpha)."""
import os
import numpy as np
import cv2
from PIL import Image

from common import (ref_rgb, inpaint_patch, disk, poly_mask, half, save, TOOLS, clean_mask)
from hero_parts import hero_alpha, X0, Y0, X1, Y1

CACHE = os.path.join(TOOLS, ".cache")

# ------------------------------------------------------------------ hero + whip removal
WHIP_CORDS = [
    [(562, 1340), (540, 1352), (515, 1366), (492, 1380), (472, 1392), (468, 1402), (480, 1405), (505, 1402),
     (530, 1396), (540, 1392)],
    [(540, 1392), (528, 1405), (510, 1420), (490, 1436), (470, 1447), (450, 1452), (420, 1455), (390, 1455),
     (372, 1452), (355, 1442), (335, 1428), (315, 1418), (295, 1410), (275, 1408), (255, 1410), (240, 1414),
     (225, 1420)],
]
WHIP_BEAM = [(575, 1325), (520, 1328), (470, 1336), (420, 1348), (370, 1362), (320, 1376), (280, 1388),
             (252, 1398), (258, 1412), (300, 1404), (350, 1392), (400, 1380), (450, 1368), (500, 1362),
             (545, 1362), (580, 1350)]
WHIP_ZONE = [(225, 1380), (300, 1340), (430, 1315), (575, 1315), (580, 1350), (560, 1400), (500, 1470),
             (330, 1450), (225, 1440)]


def hero_hole(R):
    H, W = R.shape[:2]
    hole = np.zeros((H, W), np.uint8)
    hole[Y0:Y1, X0:X1] = cv2.dilate(hero_alpha(), disk(2))
    for c in WHIP_CORDS:
        cv2.polylines(hole, [np.array(c, np.int32)], False, 1, 12)
    hole |= poly_mask(R.shape, WHIP_BEAM)
    f = R.astype(np.float32)
    g = f.mean(-1)
    bgl = cv2.medianBlur(g.astype(np.uint8), 21).astype(np.float32)
    bright = (((g - bgl) > 22) | (g > 165)) & (poly_mask(R.shape, WHIP_ZONE) > 0)
    hole |= cv2.dilate(bright.astype(np.uint8), disk(2))
    glow = np.zeros((H, W), np.uint8)
    cv2.ellipse(glow, (520, 1345), (85, 32), -10, 0, 360, 1, -1)
    warm = ((f[..., 0] - f[..., 2]) > 8) & (g > 80)
    hole |= (warm & (glow > 0)).astype(np.uint8)
    # broken fence pieces right of x=380 (they would sit on the bg_far mirror seam)
    lum = g
    fz = poly_mask(R.shape, [(398, 1372), (575, 1372), (575, 1498), (380, 1498), (380, 1430), (398, 1430)]) > 0
    hole |= cv2.dilate(((lum < 62) & fz).astype(np.uint8), disk(2))
    return cv2.dilate(hole, disk(1)).astype(bool), glow > 0


def remove_hero(R):
    """Return the reference with the heroine + whip + glow removed (cached)."""
    os.makedirs(CACHE, exist_ok=True)
    cp = os.path.join(CACHE, "nohero.png")
    if os.path.exists(cp):
        return np.array(Image.open(cp).convert("RGB"))
    hole, glow = hero_hole(R)
    x0, y0, x1, y1 = 200, 1140, 890, 1500
    img = R[y0:y1, x0:x1].copy()
    h = hole[y0:y1, x0:x1].copy()
    g = glow[y0:y1, x0:x1]
    yy, xx = np.mgrid[0:h.shape[0], 0:h.shape[1]]
    yy, xx = yy + y0, xx + x0
    known = ~h & ~g
    lum = img.astype(np.float32).mean(-1)
    fence_dark = (lum < 70) & (yy > 1372)
    # passes: (target region, source region, patch, search half-width x, half-height y)
    passes = [((yy < 1334) & (xx >= 545), (yy < 1334), 9, 8, 200),                  # facades: copy vertically
              ((yy >= 1334) & (yy < 1356) & (xx >= 545), (yy >= 1334) & (yy < 1356), 7, 400, 2),  # bridge rail
              ((yy >= 1356) & (xx >= 545), (yy >= 1356) & (xx >= 545), 9, 200, 20),  # bridge body / arches
              ((xx < 545), (xx < 545) & ~fence_dark, 9, 80, 30)]                     # fog (whip)
    for tgt, srcm, P, mx, my in passes:
        hh = h & tgt
        img = inpaint_patch(img, hh, patch=P, mx=mx, my=my, src_mask=srcm & known)
        h &= ~hh
        known |= hh
    out = R.copy()
    out[y0:y1, x0:x1] = img
    Image.fromarray(out).save(cp)
    return out


# ------------------------------------------------------------------ bg_far
FAR_X0, FAR_X1 = 407, 858      # mirror axes: art-deco tower axis (x=407) and just left of the truss tower
FAR_Y0, FAR_Y1 = 250, 1490


def build_far(R):
    C = R[FAR_Y0:FAR_Y1, FAR_X0:FAR_X1]
    tile = np.concatenate([C[:, ::-1], C], 1)         # mirror-tiled => periodic & seamless
    small = half(tile)
    return save("bg_far.png", small)




# ------------------------------------------------------------------ bg_mid
MID_LEFT = [(0, 700), (30, 718), (150, 768), (158, 745), (198, 748), (204, 800), (222, 822), (246, 888),
            (242, 925), (160, 935), (150, 1000), (170, 1140), (180, 1230), (262, 1240), (292, 1300),
            (292, 1400), (255, 1470), (255, 1495), (0, 1495)]
MID_RIGHT = [(1100, 535), (1120, 535), (1125, 560), (1150, 535), (1172, 535), (1172, 600), (1200, 600),
             (1200, 1290), (1180, 1290), (1180, 1495), (1050, 1495), (1050, 1380), (1070, 1290), (1080, 1100),
             (1100, 1000), (1030, 1000), (1030, 940), (1100, 940)]
MID_BOTTOM = 1495
MID_TOP = 520
MID_W = 900     # game px; one repeat of the layer


def matte_structure(R, poly):
    from common import clean_mask
    Ri = R.astype(int)
    warm = Ri[..., 0] - Ri[..., 2]
    lum = Ri.mean(-1)
    pm = poly_mask(R.shape, poly)
    m = ((warm > -8) | (lum < 38)).astype(np.uint8) & pm
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, disk(1))
    m = clean_mask(m, 120)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, disk(1)) & pm
    ys, xs = np.where(pm)
    x0, x1 = xs.min(), xs.max() + 1
    rgba = np.dstack([R[MID_TOP:MID_BOTTOM, x0:x1], m[MID_TOP:MID_BOTTOM, x0:x1] * 255])
    return rgba, x0


def build_mid(R):
    from common import paste
    L, _ = matte_structure(R, MID_LEFT)
    Rg, _ = matte_structure(R, MID_RIGHT)
    Ls, Rs = half(L), half(Rg)
    h = Ls.shape[0]
    can = np.zeros((h, MID_W, 4), np.uint8)
    paste(can, Ls, 20, 0)
    paste(can, Rs, 560, 0)
    return save("bg_mid.png", can)


if __name__ == "__main__":
    R = ref_rgb()
    NR = remove_hero(R)
    print(build_far(NR))
    print(build_mid(NR))


# ------------------------------------------------------------------ bg_interior
def build_interior(R):
    """Dark interior brick wall (tileable X+Y) with the original wall pipe, sconce and barred window
    composited back in at their positions; brick base is quilted from the reference."""
    from common import quilt, wrap_x, wrap_y, flatten_lab, paste
    from build_tiles import rain_mask
    # base: quilt the cold dark brick (larger tile 512x512 full-res -> 256 game px)
    x0, y0, x1, y1 = 690, 2010, 1000, 2200
    s = flatten_lab(R[y0:y1, x0:x1].copy(), 22, True, 0.85)
    ok = ~rain_mask(s)
    ok[2095 - y0:, 860 - x0:] = False
    ok[:2060 - y0, 770 - x0:790 - x0] = False
    per = 37
    Ht = 14 * per                      # 518
    q = quilt(s, ok, (Ht + per, 520 + 28), block=48, ov=12, seed=11, tol=0.05, align_y=per)
    q = wrap_y(wrap_x(q, 520, 28), Ht, per)
    q = (q.astype(np.float32) * 1.1).clip(0, 255).astype(np.uint8)
    base = np.dstack([q, np.full(q.shape[:2], 255, np.uint8)])
    # props from the reference (full-res), composited onto the base
    from build_props import cutout, trim
    pipe = cutout(R, [(384, 1738), (430, 1738), (430, 1802), (427, 1872), (416, 1886), (398, 1893),
                      (292, 1893), (291, 2180), (254, 2180), (254, 1884), (262, 1866), (280, 1851),
                      (384, 1851)], band=1)
    pipe = trim(pipe)
    win = R[1858:2178, 0:122].copy()
    wa = np.full(win.shape[:2], 255, np.uint8)
    out = base.copy()
    paste(out, np.dstack([win, wa]), 40, 70)
    # straight vertical pipe through the full height (left drop, repeated: tiles vertically), plus the
    # original elbow branch (upper-right drop -> horizontal run) entering from the top edge.
    straight = cutout(R, [(254, 1960), (292, 1960), (292, 2140), (254, 2140)], method="poly", pad=2)
    seg = straight[:, :]
    # repeat a 2-coupling-period chunk (y 1965..2073 = 108 px between couplings) to fill Ht
    chunk = seg[5:113]
    col = np.concatenate([chunk] * (Ht // chunk.shape[0] + 2), 0)[:Ht]
    px = 300
    paste(out, col, px, 0)
    # branch = rows of the L above y 1900 (top-right drop + horizontal + elbow)
    branch = R[1738:1900, 250:432].copy()
    bm = cutout(R, [(384, 1738), (430, 1738), (430, 1802), (427, 1872), (416, 1886), (398, 1893),
                    (292, 1893), (291, 1899), (254, 1899), (254, 1884), (262, 1866), (280, 1851),
                    (384, 1851)], band=1, pad=0)
    # cutout() crops to the polygon box (x 254-430, y 1738-1899); the right drop runs the full height
    drop = cutout(R, [(386, 1745), (429, 1745), (429, 1795), (386, 1795)], method="poly", pad=0)
    dcol = np.concatenate([drop] * (Ht // drop.shape[0] + 2), 0)[:Ht]
    paste(out, dcol, px - 4 + (386 - 254), 0)
    paste(out, bm, px - 4, 0)
    return save("bg_interior.png", half(out))
