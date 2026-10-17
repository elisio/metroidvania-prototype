"""Shared helpers for the asset pipeline (all art derived from assets/src/reference.jpg)."""
import os
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF_PATH = os.path.join(ROOT, "assets", "src", "reference.jpg")
OUT = os.path.join(ROOT, "assets", "game")
TOOLS = os.path.join(ROOT, "tools")
SCALE = 0.5

_ref = None


def ref_rgb():
    """Reference image as HxWx3 uint8 RGB."""
    global _ref
    if _ref is None:
        _ref = np.array(Image.open(REF_PATH).convert("RGB"))
    return _ref.copy()


def ref_bgr():
    return ref_rgb()[..., ::-1].copy()


def save(name, arr_or_img):
    """Save RGBA PNG to assets/game/<name>. Returns (w,h)."""
    os.makedirs(OUT, exist_ok=True)
    im = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray(arr_or_img)
    im = im.convert("RGBA")
    im.save(os.path.join(OUT, name), optimize=True)
    return im.size


# ---------------------------------------------------------------- resampling
def premul(rgba):
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    out = rgba.astype(np.float32)
    out[..., :3] *= a
    return out


def unpremul(f):
    a = f[..., 3:4] / 255.0
    rgb = np.where(a > 1e-4, f[..., :3] / np.maximum(a, 1e-4), 0)
    out = np.concatenate([rgb, f[..., 3:4]], -1)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def resize_rgba(rgba, w, h):
    """Alpha-correct LANCZOS resize (premultiplied)."""
    f = premul(rgba)
    chans = [np.array(Image.fromarray(f[..., i]).resize((w, h), Image.LANCZOS)) for i in range(4)]
    f2 = np.clip(np.stack(chans, -1), 0, 255)
    f2[..., :3] = np.minimum(f2[..., :3], f2[..., 3:4])
    return unpremul(f2)


def half(rgba_or_rgb):
    a = rgba_or_rgb
    if a.shape[2] == 3:
        a = np.dstack([a, np.full(a.shape[:2], 255, np.uint8)])
    h, w = a.shape[:2]
    return resize_rgba(a, max(1, round(w * SCALE)), max(1, round(h * SCALE)))


def warp_rgba(rgba, M, size, interp=cv2.INTER_CUBIC):
    """Affine warp of an RGBA layer (premultiplied). size=(w,h)."""
    f = premul(rgba)
    o = cv2.warpAffine(f, M, size, flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    o = np.clip(o, 0, 255)
    o[..., :3] = np.minimum(o[..., :3], o[..., 3:4])
    return unpremul(o)


def over(dst, src):
    """Alpha composite src over dst (both RGBA uint8 same size)."""
    sa = src[..., 3:4].astype(np.float32) / 255
    da = dst[..., 3:4].astype(np.float32) / 255
    oa = sa + da * (1 - sa)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    return np.concatenate([np.clip(rgb + 0.5, 0, 255), np.clip(oa * 255 + 0.5, 0, 255)], -1).astype(np.uint8)


def paste(dst, src, x, y):
    """Composite src at integer offset (x,y) on dst, clipped."""
    H, W = dst.shape[:2]
    h, w = src.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return dst
    dst[y0:y1, x0:x1] = over(dst[y0:y1, x0:x1], src[y0 - y:y1 - y, x0 - x:x1 - x])
    return dst


# ---------------------------------------------------------------- masks
def poly_mask(shape, pts, offset=(0, 0)):
    m = np.zeros(shape[:2], np.uint8)
    p = (np.array(pts, np.float64) - np.array(offset)).round().astype(np.int32)
    cv2.fillPoly(m, [p], 1)
    return m


def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def grabcut_band(bgr, poly, band=3, iters=6, extra_fg=None, extra_bg=None):
    """GrabCut restricted to a band around a hand-traced polygon mask (uint8 0/1)."""
    cv2.setRNGSeed(1234)
    inner = cv2.erode(poly, disk(band))
    outer = cv2.dilate(poly, disk(band))
    m = np.full(poly.shape, cv2.GC_BGD, np.uint8)
    m[outer > 0] = cv2.GC_PR_BGD
    m[poly > 0] = cv2.GC_PR_FGD
    m[inner > 0] = cv2.GC_FGD
    if extra_fg is not None:
        m[extra_fg > 0] = cv2.GC_FGD
    if extra_bg is not None:
        m[extra_bg > 0] = cv2.GC_BGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, m, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    return np.where((m == 1) | (m == 3), 1, 0).astype(np.uint8)


def clean_mask(m, min_area=12):
    """Remove small islands and fill small holes."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= min_area:
            keep[lab == i] = 1
    inv = 1 - keep
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv.astype(np.uint8), 4)
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < min_area and x > 0 and y > 0 and x + w < m.shape[1] and y + h < m.shape[0]:
            keep[lab == i] = 1
    return keep


def soft_alpha(m, feather=0.6):
    """Binary mask -> slightly anti-aliased alpha (keeps pixel-art crispness)."""
    a = m.astype(np.float32)
    if feather > 0:
        a = cv2.GaussianBlur(a, (0, 0), feather)
        a = np.maximum(a * 1.0, 0)
        a = np.where(m > 0, np.maximum(a, 0.85), a * 0.6)
    return np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)


def push_fill(rgb, known, region, iters=200):
    """Fill pixels of `region` not in `known` by diffusing colours outward from known pixels."""
    rgb = rgb.astype(np.float32).copy()
    k = known.astype(bool).copy()
    todo = region.astype(bool) & ~k
    kern = np.ones((3, 3), np.float32)
    for _ in range(iters):
        if not todo.any():
            break
        w = cv2.filter2D(k.astype(np.float32), -1, kern, borderType=cv2.BORDER_CONSTANT)
        s = np.stack([cv2.filter2D(rgb[..., c] * k, -1, kern, borderType=cv2.BORDER_CONSTANT) for c in range(3)], -1)
        new = todo & (w > 0)
        rgb[new] = s[new] / w[new][:, None]
        k |= new
        todo &= ~new
    return np.clip(rgb + 0.5, 0, 255).astype(np.uint8)


def bluish_fringe(rgb, m, iters=2, thr=28, vmin=70):
    """Peel boundary pixels that look like the blue/grey background."""
    m = m.copy()
    c = rgb.astype(int)
    blu = ((c[..., 2] - c[..., 0]) > thr) & (c.max(-1) > vmin)
    for _ in range(iters):
        edge = m.astype(bool) & ~cv2.erode(m, disk(1)).astype(bool)
        rm = edge & blu
        if not rm.any():
            break
        m[rm] = 0
    return m


# ---------------------------------------------------------------- seamless
def seam_x(img, overlap):
    """Make an image tile horizontally: crossfade the last `overlap` cols onto the first, then crop."""
    img = img.astype(np.float32)
    h, w = img.shape[:2]
    out = img[:, :w - overlap].copy()
    t = np.linspace(0, 1, overlap)[None, :, None]
    # left edge of out blends from (right tail of img) to (left of img)
    out[:, :overlap] = img[:, w - overlap:] * (1 - t) + img[:, :overlap] * t
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def seam_y(img, overlap):
    return seam_x(img.transpose(1, 0, 2), overlap).transpose(1, 0, 2).copy()


def best_period(strip, lo, hi, axis=1):
    """Find shift p in [lo,hi] minimizing difference between column i and i+p (for repeating textures)."""
    a = strip.astype(np.float32)
    if axis == 0:
        a = a.transpose(1, 0, 2)
    best, bp = 1e18, lo
    for p in range(lo, hi + 1):
        d = np.mean((a[:, p:] - a[:, :-p]) ** 2)
        if d < best:
            best, bp = d, p
    return bp, best


def checker(w, h, s=8):
    yy, xx = np.mgrid[0:h, 0:w]
    c = (((xx // s) + (yy // s)) % 2).astype(np.uint8)
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = np.where(c[..., None] == 1, 96, 64)
    out[..., 3] = 255
    return out


# ---------------------------------------------------------------- exemplar inpainting
def inpaint_patch(img, hole, patch=9, mx=120, my=40, src_mask=None, verbose=False):
    """Criminisi-style exemplar inpainting with a local (anisotropic) search window.

    img  : HxWx3 uint8 RGB; hole: HxW mask of pixels to synthesise
    patch: odd patch size; mx,my: half-size of the search window around each target patch
    src_mask: optional mask of pixels allowed as source (default: everything not in hole)
    """
    img = img.astype(np.float32).copy()
    hole = hole.astype(bool).copy()
    H, W = hole.shape
    r = patch // 2
    allowed = ~hole if src_mask is None else (src_mask.astype(bool) & ~hole)
    valid = cv2.erode(allowed.astype(np.uint8), np.ones((patch, patch), np.uint8)).astype(bool)
    valid[:r, :] = valid[-r:, :] = False
    valid[:, :r] = valid[:, -r:] = False
    conf = (~hole).astype(np.float32)
    gray = cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    it = 0
    while hole.any():
        it += 1
        hu = hole.astype(np.uint8)
        front = hole & ~cv2.erode(hu, disk(1)).astype(bool)
        fy, fx = np.where(front)
        cs = cv2.boxFilter(conf, -1, (patch, patch), normalize=True, borderType=cv2.BORDER_CONSTANT)
        nm = cv2.GaussianBlur(hu.astype(np.float32), (0, 0), 1.5)
        nx = cv2.Sobel(nm, cv2.CV_32F, 1, 0, ksize=3)
        ny = cv2.Sobel(nm, cv2.CV_32F, 0, 1, ksize=3)
        nn = np.sqrt(nx ** 2 + ny ** 2) + 1e-6
        known = ~hole
        gxs = cv2.blur(np.where(known, gx, 0), (3, 3))
        gys = cv2.blur(np.where(known, gy, 0), (3, 3))
        pri = cs[fy, fx] * (np.abs(-gys[fy, fx] * nx[fy, fx] + gxs[fy, fx] * ny[fy, fx]) / nn[fy, fx] / 255.0 + 0.02)
        k = int(np.argmax(pri))
        cy, cx = int(fy[k]), int(fx[k])
        y0, y1 = max(0, cy - r), min(H, cy + r + 1)
        x0, x1 = max(0, cx - r), min(W, cx + r + 1)
        tpl = img[y0:y1, x0:x1]
        tmask = np.repeat((~hole[y0:y1, x0:x1]).astype(np.float32)[..., None], 3, -1)
        th, tw = tpl.shape[:2]
        oy, ox = cy - y0, cx - x0
        found = False
        for grow in (1, 2, 4, 8):
            wy0, wy1 = max(0, cy - my * grow - r), min(H, cy + my * grow + r + 1)
            wx0, wx1 = max(0, cx - mx * grow - r), min(W, cx + mx * grow + r + 1)
            region = img[wy0:wy1, wx0:wx1]
            if region.shape[0] < th or region.shape[1] < tw:
                continue
            res = cv2.matchTemplate(region, tpl, cv2.TM_SQDIFF, mask=tmask)
            vv = valid[wy0 + oy:wy0 + oy + res.shape[0], wx0 + ox:wx0 + ox + res.shape[1]]
            if vv.shape != res.shape:
                v2 = np.zeros(res.shape, bool)
                v2[:vv.shape[0], :vv.shape[1]] = vv
                vv = v2
            res = np.where(vv, res, np.inf)
            if np.isfinite(res).any():
                found = True
                break
        if not found:
            img = push_fill(img, ~hole, np.ones_like(hole)).astype(np.float32)
            break
        iy, ix = np.unravel_index(int(np.argmin(res)), res.shape)
        sy, sx = wy0 + iy, wx0 + ix
        fill = hole[y0:y1, x0:x1]
        img[y0:y1, x0:x1][fill] = img[sy:sy + th, sx:sx + tw][fill]
        gx[y0:y1, x0:x1][fill] = gx[sy:sy + th, sx:sx + tw][fill]
        gy[y0:y1, x0:x1][fill] = gy[sy:sy + th, sx:sx + tw][fill]
        conf[y0:y1, x0:x1][fill] = cs[cy, cx]
        hole[y0:y1, x0:x1][fill] = False
        if verbose and it % 300 == 0:
            print("inpaint it", it, "left", int(hole.sum()))
    return np.clip(img + 0.5, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- quilting wrap (seamless tiles)
def _min_cut_vertical(err):
    """DP minimal vertical path through err (H x ov). Returns col index per row."""
    H, W = err.shape
    E = err.copy()
    for y in range(1, H):
        prev = E[y - 1]
        left = np.r_[np.inf, prev[:-1]]
        right = np.r_[prev[1:], np.inf]
        E[y] += np.minimum(np.minimum(left, prev), right)
    path = np.zeros(H, int)
    path[-1] = int(np.argmin(E[-1]))
    for y in range(H - 2, -1, -1):
        x = path[y + 1]
        lo, hi = max(0, x - 1), min(W, x + 2)
        path[y] = lo + int(np.argmin(E[y, lo:hi]))
    return path


def wrap_x(img, W, ov):
    """img width >= W+ov. Returns W-wide image that tiles horizontally, joined by a min-error cut.

    Columns [W, W+ov) naturally continue from column W-1; they replace columns [0,ov) left of the
    cut, so out[:, -1] -> out[:, 0] is seamless.
    """
    img = img.astype(np.float32)
    A = img[:, :ov]          # original start
    B = img[:, W:W + ov]     # continuation of the end
    err = ((A[..., :3] - B[..., :3]) ** 2).sum(-1)
    path = _min_cut_vertical(err)
    out = img[:, :W].copy()
    cols = np.arange(ov)[None, :]
    useB = cols < path[:, None]
    # 1px feather across the cut
    wB = useB.astype(np.float32)
    wB = cv2.blur(wB, (3, 1))
    out[:, :ov] = B * wB[..., None] + A * (1 - wB[..., None])
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def wrap_y(img, H, ov):
    return wrap_x(img.transpose(1, 0, 2), H, ov).transpose(1, 0, 2).copy()


def flatten_light(rgb, sigma=40, strength=1.0):
    """Remove low-frequency illumination gradients (for tileable textures)."""
    f = rgb.astype(np.float32)
    lum = f.mean(-1) + 1
    low = cv2.GaussianBlur(lum, (0, 0), sigma)
    gain = (lum.mean() / low) ** strength
    out = f * gain[..., None]
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def quilt(sample, ok, out_hw, block=40, ov=10, align_y=None, seed=0, tol=0.15):
    """Efros-Freeman image quilting (overlap SSD via cv2.matchTemplate, min-error boundary cuts).

    sample: RGB source; ok: bool mask of usable source pixels; out_hw: (H,W)
    align_y: if set, a source block's top y must be congruent to the target y modulo align_y
    """
    rng = np.random.default_rng(seed)
    S = sample.astype(np.float32)
    Hs, Ws = ok.shape
    step = block - ov
    H, W = out_hw
    ny = max(1, -(-(H - ov) // step))
    nx = max(1, -(-(W - ov) // step))
    out = np.zeros((ny * step + ov, nx * step + ov, 3), np.float32)
    okb = cv2.erode(ok.astype(np.uint8), np.ones((block, block), np.uint8), anchor=(0, 0),
                    borderType=cv2.BORDER_CONSTANT, borderValue=0).astype(bool)
    okb = okb[:Hs - block + 1, :Ws - block + 1]
    rows = np.arange(okb.shape[0])[:, None]
    for by in range(ny):
        for bx in range(nx):
            y, x = by * step, bx * step
            valid = okb.copy()
            if align_y:
                v2 = valid & ((rows - y) % align_y == 0)
                if v2.any():
                    valid = v2
            if by == 0 and bx == 0:
                cand = np.argwhere(valid)
                sy, sx = cand[rng.integers(len(cand))]
            else:
                tm = np.zeros((block, block), np.float32)
                if bx > 0:
                    tm[:, :ov] = 1
                if by > 0:
                    tm[:ov, :] = 1
                tpl = out[y:y + block, x:x + block].copy()
                res = cv2.matchTemplate(S, tpl, cv2.TM_SQDIFF, mask=np.repeat(tm[..., None], 3, -1))
                res = np.where(valid, res, np.inf)
                mn = res.min()
                good = np.argwhere(res <= mn * (1 + tol) + 1e-3)
                sy, sx = good[rng.integers(len(good))]
            blk = S[sy:sy + block, sx:sx + block].copy()
            mask = np.ones((block, block), bool)
            if bx > 0:
                err = ((blk[:, :ov] - out[y:y + block, x:x + ov]) ** 2).sum(-1)
                p = _min_cut_vertical(err)
                mask[:, :ov] &= np.arange(ov)[None, :] >= p[:, None]
            if by > 0:
                err = ((blk[:ov, :] - out[y:y + ov, x:x + block]) ** 2).sum(-1).T
                p = _min_cut_vertical(err)
                mask[:ov, :] &= (np.arange(ov)[:, None] >= p[None, :])
            region = out[y:y + block, x:x + block]
            region[mask] = blk[mask]
    return np.clip(out[:H, :W] + 0.5, 0, 255).astype(np.uint8)


def flatten_lab(rgb, sigma=20, chroma=True, strength=1.0):
    """Remove low-frequency variation of lightness (and optionally colour cast) in LAB space."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    chans = (0, 1, 2) if chroma else (0,)
    for ch in chans:
        low = cv2.GaussianBlur(lab[..., ch], (0, 0), sigma)
        lab[..., ch] = lab[..., ch] - strength * (low - low.mean())
    lab = np.clip(lab, 0, 255).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
