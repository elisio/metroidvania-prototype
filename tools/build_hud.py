"""HUD pieces cut from the top of the reference. Frames keep only the metal border (interiors cleared)."""
import numpy as np
import cv2

from common import ref_rgb, half, save, disk, clean_mask, soft_alpha, poly_mask

HUD_BG = np.array([28, 32, 51])  # flat navy panel colour behind the HUD


def bg_alpha(c, tol=16, feather=True):
    """Alpha from distance to the HUD panel colour."""
    d = np.abs(c.astype(int) - HUD_BG).max(-1)
    m = (d > tol).astype(np.uint8)
    m = clean_mask(m, 12)
    return m


def fill_holes(m):
    """Fill background regions not connected to the image border."""
    inv = (1 - m).astype(np.uint8)
    n, lab = cv2.connectedComponents(inv, connectivity=4)
    border = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]]).tolist())
    holes = (inv > 0) & ~np.isin(lab, list(border))
    return (m | holes).astype(np.uint8)


def keep_large(m, frac=0.05):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    if n <= 1:
        return m
    big = st[1:, cv2.CC_STAT_AREA].max()
    out = np.zeros_like(m)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= big * frac:
            out[lab == i] = 1
    return out


def rgba(c, m, feather=0.5):
    return np.dstack([c, soft_alpha(m, feather)])


# ------------------------------------------------------------------ portrait
PC = (120.5, 126.5)   # portrait circle centre


def build_portrait(R):
    """hud_portrait_frame.png: the ring (interior transparent). hero_portrait.png: the face disc."""
    x0, y0, x1, y1 = 14, 22, 228, 232
    c = R[y0:y1, x0:x1].copy()
    h, w = c.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = PC[0] - x0, PC[1] - y0
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    ang = (np.degrees(np.arctan2(yy - cy, xx - cx)) + 360) % 360
    # ring = everything non-panel between r 76 and r 104 (+ the bat-wing ornaments on top)
    m = bg_alpha(c)
    inner = r < 77
    m[inner] = 0
    # the "1" badge (lower right) and "2"/heart badge (lower left) overlap the ring: drop them
    badges = np.zeros((h, w), np.uint8)
    cv2.circle(badges, (int(207.5 - x0), int(196 - y0)), 39, 1, -1)
    cv2.circle(badges, (int(54.5 - x0), int(226.5 - y0)), 38, 1, -1)
    cv2.rectangle(badges, (int(70 - x0), int(205 - y0)), (int(162 - x0), int(250 - y0)), 1, -1)
    # bar ornaments to the right of the portrait
    cv2.rectangle(badges, (int(203 - x0), 0), (w, int(165 - y0)), 1, -1)
    m[badges > 0] = 0
    # rebuild the ring where badges covered it: copy from the mirrored side (portrait ring is ~symmetric)
    ringzone = (r >= 76) & (r <= 103)
    missing = ringzone & (badges > 0)
    mir = cv2.flip(c, 1)
    mm = cv2.flip(bg_alpha(c), 1)
    # mirror around x=cx: flip then shift so that cx maps to cx
    shift = int(round(2 * cx - (w - 1)))
    M = np.float32([[1, 0, shift], [0, 1, 0]])
    mir = cv2.warpAffine(mir, M, (w, h), flags=cv2.INTER_NEAREST)
    mm = cv2.warpAffine(mm, M, (w, h), flags=cv2.INTER_NEAREST)
    # rotate-copy for bottom where the mirrored side is also covered: use a rotated ring sample
    rot = cv2.warpAffine(c, cv2.getRotationMatrix2D((cx, cy), 60, 1.0), (w, h), flags=cv2.INTER_NEAREST)
    rotm = cv2.warpAffine(bg_alpha(c) * (1 - badges), cv2.getRotationMatrix2D((cx, cy), 60, 1.0), (w, h),
                          flags=cv2.INTER_NEAREST)
    mirok = (mm > 0) & ~cv2.warpAffine(cv2.flip(badges, 1), M, (w, h), flags=cv2.INTER_NEAREST).astype(bool)
    use_m = missing & mirok
    c2 = c.copy()
    c2[use_m] = mir[use_m]
    m[use_m] = 1
    rest = missing & ~use_m & (rotm > 0)
    c2[rest] = rot[rest]
    m[rest] = 1
    # interior of ring at r<77 is transparent; keep only the ring band + top ornaments
    m[(r > 104) & (yy > cy)] = 0
    m = clean_mask(m, 30)
    frame = rgba(c2, m)
    a = save("hud_portrait_frame.png", half(frame))

    # face disc
    fm = (r < 77.5).astype(np.uint8)
    face = rgba(c, fm, 0.6)
    ys, xs = np.where(fm > 0)
    face = face[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    b = save("hero_portrait.png", half(face))
    return a, b


def build_bars(R):
    """hud_bar_frame.png: both bar frames (HP on top, MP below) with interiors cleared."""
    x0, y0, x1, y1 = 196, 50, 700, 160
    c = R[y0:y1, x0:x1].copy()
    m = bg_alpha(c)
    # interiors (measured): HP x 229..659 y 69..92 ; MP x 229..584 y 117..140
    for (ix0, iy0, ix1, iy1) in ((231, 67, 658, 93), (231, 115, 583, 141)):
        m[iy0 - y0:iy1 - y0 + 1, ix0 - x0:ix1 - x0 + 1] = 0
    # remove the portrait ornament that intrudes on the left (x<205)
    m[:, :8] = 0
    m[155 - y0:, :] = 0
    m = keep_large(clean_mask(m, 30), 0.2)
    out = rgba(c, m)
    ys, xs = np.where(m > 0)
    out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return save("hud_bar_frame.png", half(out))


def build_hearts(R):
    full = R[167:216, 274:326].copy()
    empty = R[167:216, 382:434].copy()
    res = []
    for c, name in ((full, "hud_heart_full.png"), (empty, "hud_heart_empty.png")):
        m = bg_alpha(c, 18)
        m = fill_holes(m)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, disk(1))
        m = clean_mask(m, 40)
        n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
        big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        m = (lab == big).astype(np.uint8)
        res.append(save(name, half(rgba(c, m))))
    return res


def build_slots(R):
    # slot frames at (797..877, 50..130) and (797..877, 147..225)
    book = R[44:136, 792:884].copy()
    potion = R[140:232, 792:884].copy()
    res = []
    # empty slot frame from the book slot: clear interior
    m = bg_alpha(book, 14)
    inner = np.zeros_like(m)
    inner[13:80, 12:80] = 1
    frame_m = m & (1 - inner)
    frame_m = clean_mask(frame_m, 20)
    frame = rgba(book, frame_m)
    frame[inner > 0] = 0
    res.append(save("hud_slot.png", half(frame)))
    # icons: interior content only
    for c, name in ((book, "icon_book.png"), (potion, "icon_potion.png")):
        im = bg_alpha(c, 22)
        inn = np.zeros_like(im)
        inn[14:80, 13:79] = 1
        im = im & inn
        im = cv2.morphologyEx(im, cv2.MORPH_CLOSE, disk(1))
        im = clean_mask(im, 20)
        ys, xs = np.where(im > 0)
        o = rgba(c, im)[ys.min() - 1:ys.max() + 2, xs.min() - 1:xs.max() + 2]
        res.append(save(name, half(o)))
    return res


def build_minimap(R):
    x0, y0, x1, y1 = 900, 22, 1300, 250
    c = R[y0:y1, x0:x1].copy()
    m = bg_alpha(c, 14)
    # interior (dark map area incl. rooms): x 921..1260, y 50..218 -> clear
    m[50 - y0:219 - y0, 922 - x0:1260 - x0] = 0
    m = clean_mask(m, 30)
    out = rgba(c, m)
    ys, xs = np.where(m > 0)
    out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return save("hud_minimap_frame.png", half(out))


def build_badges(R):
    res = []
    # level badge "1": circle centre ~(207.5,196) r~37
    x0, y0 = 166, 154
    c = R[y0:y0 + 84, x0:x0 + 84].copy()
    yy, xx = np.mgrid[0:84, 0:84]
    m = (((xx - (207.5 - x0)) ** 2 + (yy - (196 - y0)) ** 2) <= 38.5 ** 2).astype(np.uint8)
    res.append(save("hud_level_badge.png", half(rgba(c, m, 0.6))))
    # lives badge: heart circle + "2" plate (x 18..162, y 188..262)
    x0, y0, x1, y1 = 16, 186, 166, 266
    c = R[y0:y1, x0:x1].copy()
    m = bg_alpha(c, 14)
    m = fill_holes(m)
    # cut away the portrait ring above the badge
    yy, xx = np.mgrid[0:c.shape[0], 0:c.shape[1]]
    rr = np.sqrt((xx + x0 - PC[0]) ** 2 + (yy + y0 - PC[1]) ** 2)
    circ = ((xx + x0 - 54.5) ** 2 + (yy + y0 - 226.5) ** 2) <= 37 ** 2
    plate = (xx + x0 >= 76) & (xx + x0 <= 162) & (yy + y0 >= 205) & (yy + y0 <= 252)
    m = m & (circ | plate).astype(np.uint8)
    m = clean_mask(m, 30)
    res.append(save("hud_lives_badge.png", half(rgba(c, m, 0.6))))
    return res


def build_all():
    R = ref_rgb()
    return dict(portrait=build_portrait(R), bars=build_bars(R), hearts=build_hearts(R), slots=build_slots(R),
                minimap=build_minimap(R), badges=build_badges(R))


if __name__ == "__main__":
    print(build_all())
