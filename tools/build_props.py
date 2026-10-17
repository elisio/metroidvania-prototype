"""Props with alpha, cut from the reference."""
import numpy as np
import cv2

from common import (ref_rgb, poly_mask, grabcut_band, clean_mask, half, save, disk, soft_alpha, resize_rgba)


def crop_box(poly, pad=4):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs) - pad, min(ys) - pad, max(xs) + pad + 1, max(ys) + pad + 1


def cutout(R, poly, band=3, method="grabcut", extra=None, pad=4):
    """Polygon-guided cutout. Returns RGBA crop (full res)."""
    x0, y0, x1, y1 = crop_box(poly, pad)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(R.shape[1], x1), min(R.shape[0], y1)
    c = R[y0:y1, x0:x1].copy()
    pm = poly_mask(c.shape, poly, (x0, y0))
    if method == "grabcut":
        m = grabcut_band(c[..., ::-1].copy(), pm, band=band)
    else:
        m = pm
    if extra is not None:
        m = extra(c, m)
    m = clean_mask(m, 20)
    a = soft_alpha(m, 0.5)
    return np.dstack([c, a])


def trim(rgba, pad=1):
    ys, xs = np.where(rgba[..., 3] > 0)
    return rgba[max(0, ys.min() - pad):ys.max() + 1 + pad, max(0, xs.min() - pad):xs.max() + 1 + pad]


def outline(rgba, color=(12, 10, 18), w=1):
    """Add a thin dark outline outside the alpha (helps when the cut edge is soft)."""
    a = (rgba[..., 3] > 100).astype(np.uint8)
    ring = cv2.dilate(a, disk(w)) & (1 - a)
    out = rgba.copy()
    out[ring > 0, :3] = color
    out[ring > 0, 3] = 200
    return out


def pad_rgba(rgba, p):
    return np.pad(rgba, ((p, p), (p, p), (0, 0)))


# ------------------------------------------------------------------------------------------------
GARGOYLE = [(172, 1488), (178, 1492), (165, 1505), (155, 1515), (152, 1525), (160, 1540), (175, 1555),
            (195, 1545), (198, 1530), (205, 1530), (212, 1515), (225, 1500), (238, 1500), (248, 1510),
            (258, 1530), (268, 1560), (272, 1600), (270, 1640), (262, 1670), (260, 1700), (250, 1712),
            (248, 1724), (155, 1724), (150, 1712), (118, 1700), (108, 1680), (95, 1690), (80, 1680),
            (70, 1650), (64, 1610), (68, 1570), (82, 1540), (100, 1515), (130, 1497), (152, 1490)]


def build_gargoyle(R):
    g = cutout(R, GARGOYLE, band=2)
    return save("prop_gargoyle.png", half(trim(g)))


def build_lamp(R):
    # wall sconce + its warm glow halo (glow alpha from brightness, so it can be drawn additively or normally)
    x0, y0, x1, y1 = 360, 1945, 440, 2025
    c = R[y0:y1, x0:x1].astype(np.float32)
    lamp = poly_mask(c.shape, [(388, 1966), (402, 1965), (412, 1975), (412, 2004), (406, 2010), (388, 2010),
                               (382, 2002), (382, 1974)], (x0, y0)).astype(np.float32)
    lamp = cv2.GaussianBlur(lamp, (0, 0), 0.6)
    yy, xx = np.mgrid[0:c.shape[0], 0:c.shape[1]]
    d = np.sqrt(((xx - 37) / 1.0) ** 2 + ((yy - 43) / 1.0) ** 2)
    glow = np.clip(1 - d / 40, 0, 1) ** 2 * 0.55
    a = np.maximum(lamp, glow)
    col = c.copy()
    gcol = np.array([255, 196, 120], np.float32)
    col = col * lamp[..., None] + gcol * (1 - lamp[..., None])
    out = np.dstack([np.clip(col, 0, 255), a * 255]).astype(np.uint8)
    return save("prop_lamp.png", half(out))


def build_window_bars(R):
    # barred window (left, x 0-122, y 1858-2178); dark panes become semi-transparent so a light can show
    x0, y0, x1, y1 = 0, 1858, 122, 2178
    c = R[y0:y1, x0:x1].copy()
    ci = c.astype(int)
    lum = ci.mean(-1)
    warm = ci[..., 0] - ci[..., 2]
    bars = ((warm > 4) & (lum > 40)) | (lum > 70)
    bars = cv2.morphologyEx(bars.astype(np.uint8), cv2.MORPH_OPEN, disk(1))
    frame = np.zeros_like(bars)
    frame[:14, :] = 1
    frame[-12:, :] = 1
    frame[:, :8] = 1
    frame[:, -12:] = 1
    solid = (bars | frame).astype(bool)
    a = np.where(solid, 255, 150).astype(np.uint8)       # panes: dark glass at ~60% opacity
    return save("prop_window_bars.png", half(np.dstack([c, a])))


def build_fluorescent(R):
    # tube light on the right wall (x 1240-1311, y 1780-1806); extend tube by mirroring to make a full fixture
    x0, y0, x1, y1 = 1236, 1774, 1311, 1812
    c = R[y0:y1, x0:x1].copy()
    full = np.concatenate([c, c[:, ::-1]], 1)  # symmetric fixture (left end cap mirrored to the right)
    f = full.astype(int)
    lum = f.mean(-1)
    m = (lum > 70).astype(np.uint8)
    m = clean_mask(cv2.morphologyEx(m, cv2.MORPH_CLOSE, disk(1)), 10)
    a = soft_alpha(m, 0.6)
    glow = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 4) * 120
    a = np.maximum(a, glow.astype(np.uint8))
    col = full.copy()
    col[m == 0] = (255, 240, 200)
    out = pad_rgba(np.dstack([col, a]), 0)
    return save("prop_fluorescent.png", half(out))


def neon(R, box, name, hue):
    x0, y0, x1, y1 = box
    c = R[y0:y1, x0:x1].copy()
    ci = c.astype(int)
    r, g, b = ci[..., 0], ci[..., 1], ci[..., 2]
    if hue == "purple":
        sat = ((r + b) / 2 - g)
        m = (sat > 45) & (b > 120)
    else:
        sat = ((g + b) / 2 - r)
        m = (sat > 40) & (b > 150)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, disk(2))
    m = clean_mask(m, 30)
    # include the dark box behind the letters (the sign body) = filled hull of the mask
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    body = np.zeros_like(m)
    for cn in cnts:
        x, y, w, h = cv2.boundingRect(cn)
        if w * h > 200:
            cv2.rectangle(body, (x, y), (x + w - 1, y + h - 1), 1, -1)
    a = soft_alpha(body | m, 0.5)
    glow = cv2.GaussianBlur((body | m).astype(np.float32), (0, 0), 3.0)
    a = np.maximum(a, (glow * 90).astype(np.uint8))
    out = np.dstack([c, a])
    out = pad_rgba(out, 0)
    return save(name, half(out))


def build_neons(R):
    a = neon(R, (586, 1126, 642, 1278), "prop_neon_purple.png", "purple")
    b = neon(R, (232, 986, 300, 1110), "prop_neon_cyan.png", "cyan")
    return a, b


def build_water_tower(R):
    # tank on the right edge is clipped by the image border (x>1311); complete it by mirroring its left half
    x0, y0, x1, y1 = 1210, 466, 1311, 690
    c = R[y0:y1, x0:x1].copy()
    poly = [(1244, 470), (1311, 466), (1311, 690), (1262, 690), (1250, 655), (1238, 636), (1230, 600),
            (1229, 560), (1228, 520), (1225, 505), (1232, 492)]
    pm = poly_mask(c.shape, poly, (x0, y0))
    ci = c.astype(int)
    keep = ((ci[..., 0] - ci[..., 2]) > -10) | (ci.mean(-1) < 40)
    m = (pm & keep.astype(np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, disk(2))
    m = clean_mask(m, 40)
    left = np.dstack([c, m * 255])
    # mirror around the tank axis (assumed at the image border x=1311)
    full = np.concatenate([left, left[:, ::-1]], 1)
    full = trim(full)
    return save("prop_water_tower.png", half(full))


def build_pipes(R):
    # L-shaped steam pipe on the interior wall: vertical drop (x~388-428) -> elbow -> horizontal run (y~1852-1890)
    # -> elbow -> vertical drop (x~256-290) down to the floor
    poly = [(384, 1738), (430, 1738), (430, 1802), (427, 1872), (416, 1886), (398, 1893), (292, 1893),
            (291, 2180), (254, 2180), (254, 1884), (262, 1866), (280, 1851), (384, 1851)]
    g = cutout(R, poly, band=1)
    return save("prop_pipes.png", half(trim(g)))


def build_fence(R):
    """Wrought-iron fence, repaired by periodicity: posts repeat every ~30.5 px, so pixels hidden by the
    whip are copied from the same spot one/two post-periods away. A 2-post module (61 px) is cut between
    posts and repeated 3x."""
    x0, y0, x1, y1 = 240, 1380, 400, 1500
    c = R[y0:y1, x0:x1].copy()
    lum = c.astype(np.float32).mean(-1)
    from build_bg import WHIP_CORDS, WHIP_BEAM
    wm = np.zeros(R.shape[:2], np.uint8)
    for cd in WHIP_CORDS:
        cv2.polylines(wm, [np.array(cd, np.int32)], False, 1, 8)
    wm |= poly_mask(R.shape, WHIP_BEAM)
    whip = (wm[y0:y1, x0:x1] > 0) | (lum > 160)
    whip = cv2.dilate(whip.astype(np.uint8), disk(1)).astype(bool)
    fixed = c.copy()
    todo = whip.copy()
    for p in (61, -61, 30, -30, 31, -31, 92, -92, 122, -122):
        src_ok = np.zeros_like(todo)
        if p > 0:
            src_ok[:, :-p] = ~whip[:, p:]
            cand = np.zeros_like(c)
            cand[:, :-p] = c[:, p:]
        else:
            q = -p
            src_ok[:, q:] = ~whip[:, :-q]
            cand = np.zeros_like(c)
            cand[:, q:] = c[:, :-q]
        use = todo & src_ok
        fixed[use] = cand[use]
        todo &= ~use
    flum = fixed.astype(np.float32).mean(-1)
    m = (flum < 64).astype(np.uint8)
    yy, xx = np.mgrid[0:m.shape[0], 0:m.shape[1]]
    yy, xx = yy + y0, xx + x0
    keep = ((yy >= 1415) | ((xx >= 344) & (xx <= 358) & (yy >= 1384))) & (yy <= 1488)
    m = m & keep.astype(np.uint8)
    m = clean_mask(cv2.morphologyEx(m, cv2.MORPH_OPEN, disk(1)), 25)
    mod = np.dstack([fixed, soft_alpha(m, 0.5)])[:, 302 - x0:363 - x0]
    out = np.concatenate([mod, mod, mod], 1)
    ys = np.where(out[..., 3].max(1) > 0)[0]
    out = out[ys.min():ys.max() + 1]
    return save("prop_fence.png", half(out))


def build_all():
    R = ref_rgb()
    res = {}
    for fn in (build_gargoyle, build_lamp, build_window_bars, build_fluorescent, build_water_tower,
               build_pipes, build_fence):
        res[fn.__name__] = fn(R)
    res["neons"] = build_neons(R)
    return res


if __name__ == "__main__":
    print(build_all())
