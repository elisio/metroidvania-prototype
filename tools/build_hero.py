"""Cutout-animation rig for the heroine -> hero_sheet.png + hero_sheet.js + previews.

Parts (from hero_parts.py): torso(+head+guard arm+shorts), whip arm, thigh/shin for back & front legs.
Each frame = body transform (lean about hips + offset) + arm angle + per-leg 2-bone IK
(hip position, ankle target) -> rotate/translate each original cutout -> downscale 0.5.
Angles: measured from "straight down", positive towards +x (screen right) == cv2 CCW-positive.
"""
import json
import math
import os
import numpy as np
import cv2
from PIL import Image

from common import OUT, TOOLS, warp_rgba, over, resize_rgba, checker, save
from hero_parts import build_parts

CANVAS = (560, 460)      # full-res working canvas (w,h)
ORIGIN = (200, 110)      # where crop (0,0) goes on the working canvas
SC = 0.5


def ang(v):
    return math.degrees(math.atan2(v[0], v[1]))


def vec(deg, L):
    r = math.radians(deg)
    return (math.sin(r) * L, math.cos(r) * L)


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def length(v):
    return math.hypot(v[0], v[1])


def rotp(p, c, deg):
    """rotate point p around c by deg (same convention as layers)."""
    r = math.radians(deg)
    x, y = p[0] - c[0], p[1] - c[1]
    # down-vector (0,1) at +deg -> (sin, cos): x' = x cos + y sin, y' = -x sin + y cos
    return (c[0] + x * math.cos(r) + y * math.sin(r), c[1] - x * math.sin(r) + y * math.cos(r))


def M_for(rest_pivot, new_pivot, deg):
    """Affine matrix: rotate by deg around rest_pivot, then move rest_pivot to new_pivot."""
    M = cv2.getRotationMatrix2D((float(rest_pivot[0]), float(rest_pivot[1])), deg, 1.0)
    M[0, 2] += new_pivot[0] - rest_pivot[0]
    M[1, 2] += new_pivot[1] - rest_pivot[1]
    return M


def ik(hip, ankle, L1, L2, bend=+1):
    """Two-bone IK. Returns knee point. bend=+1 -> knee towards +x (forward)."""
    d = sub(ankle, hip)
    D = length(d)
    D = min(D, L1 + L2 - 0.01)
    D = max(D, abs(L1 - L2) + 0.01)
    a = math.acos((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))
    base = math.atan2(d[1], d[0])
    # in screen coords (y down) choose the side so the knee points to +x
    k1 = (hip[0] + L1 * math.cos(base - a), hip[1] + L1 * math.sin(base - a))
    k2 = (hip[0] + L1 * math.cos(base + a), hip[1] + L1 * math.sin(base + a))
    return k1 if (k1[0] - k2[0]) * bend > 0 else k2


class Rig:
    def __init__(self):
        parts, J, gy, A = build_parts()
        o = ORIGIN
        self.P = {}
        for k, v in parts.items():
            layer = np.zeros((CANVAS[1], CANVAS[0], 4), np.uint8)
            h, w = v.shape[:2]
            layer[o[1]:o[1] + h, o[0]:o[0] + w] = v
            self.P[k] = layer
        self.J = {k: (v[0] + o[0], v[1] + o[1]) for k, v in J.items()}
        self.gy = gy + o[1]
        J = self.J
        self.hipc = ((J["hip_b"][0] + J["hip_f"][0]) / 2, (J["hip_b"][1] + J["hip_f"][1]) / 2)
        self.L = {}
        self.rest = {}
        for t in "bf":
            self.L["t" + t] = length(sub(J["knee_" + t], J["hip_" + t]))
            self.L["s" + t] = length(sub(J["ankle_" + t], J["knee_" + t]))
            self.rest["t" + t] = ang(sub(J["knee_" + t], J["hip_" + t]))
            self.rest["s" + t] = ang(sub(J["ankle_" + t], J["knee_" + t]))
        self.rest["arm"] = ang(sub(J["hand"], J["shoulder"]))
        self.foot_drop = {t: self.gy - J["ankle_" + t][1] for t in "bf"}

    def pose(self, lean=0.0, body=(0, 0), arm=None, arm_front=False, feet=None, hip_shift=None,
             leg_mode="ik", leg_rot=None, sh_shift=(0, 0), foot_tilt=None):
        """Compose one frame on the working canvas. Returns rgba, hand point, feet anchor x.

        lean  : degrees, positive = top leans to +x (forward)  (rotation about hip centre)
        body  : (dx,dy) translation of the hip centre
        arm   : absolute arm direction (deg from down) or None for rest (+lean)
        feet  : {'b':(x,y),'f':(x,y)} ankle targets in canvas coords (None = rest)
        hip_shift : {'b':dx,'f':dx} moves leg hip joints horizontally (narrow stance)
        """
        J = self.J
        hc = self.hipc
        new_hc = add(hc, body)
        # rotation of the body: lean forward = top moves +x = clockwise = negative in our convention
        rb = -lean
        Mt = M_for(hc, new_hc, rb)
        layers = []

        def tp(p):
            return add(rotp(p, hc, rb), body)

        # ---- legs
        leg_layers = {}
        for t in "bf":
            hip0 = J["hip_" + t]
            hs = (hip_shift or {}).get(t, 0)
            hip = tp(add(hip0, (hs, 0)))
            if feet is None or feet.get(t) is None:
                ank = tp(J["ankle_" + t]) if leg_mode == "rigid" else J["ankle_" + t]
            else:
                ank = feet[t]
            knee = ik(hip, ank, self.L["t" + t], self.L["s" + t], +1)
            ta = ang(sub(knee, hip))
            sa = ang(sub(ank, knee))
            ank = add(knee, vec(sa, self.L["s" + t]))   # actually reached ankle (IK may clamp)
            Mth = M_for(hip0, hip, ta - self.rest["t" + t])
            Msh = M_for(J["knee_" + t], knee, sa - self.rest["s" + t])
            shin = warp_rgba(self.P["shin_" + t], Msh, CANVAS)
            thigh = warp_rgba(self.P["thigh_" + t], Mth, CANVAS)
            # foot: flat on the ground; when airborne it follows the shin partially (toes hang)
            air = min(1.0, max(0.0, (self.gy - self.foot_drop[t] - ank[1]) / 14.0))
            fr = (sa - self.rest["s" + t]) * (0.15 + 0.5 * air) + (foot_tilt or {}).get(t, 0)
            foot = warp_rgba(self.P["foot_" + t], M_for(J["ankle_" + t], ank, fr), CANVAS)
            shin = over(shin, foot)
            leg_layers[t] = (shin, thigh, ank)

        # ---- arm
        sh = add(tp(J["shoulder"]), sh_shift)
        arm_abs = (self.rest["arm"] + rb) if arm is None else arm
        Ma = M_for(J["shoulder"], sh, arm_abs - self.rest["arm"])
        arm_l = warp_rgba(self.P["arm"], Ma, CANVAS)
        hand = add(sh, vec(arm_abs, length(sub(J["hand"], J["shoulder"]))))

        torso = warp_rgba(self.P["torso"], Mt, CANVAS)

        img = np.zeros((CANVAS[1], CANVAS[0], 4), np.uint8)
        order = [leg_layers["b"][0], leg_layers["b"][1], leg_layers["f"][0], leg_layers["f"][1]]
        if not arm_front:
            order = [arm_l] + order + [torso]
        else:
            order = order + [torso, arm_l]
        for l in order:
            img = over(img, l)
        return img, hand


# ------------------------------------------------------------------ animation definitions
def frames_def(rig):
    J = rig.J
    gy = rig.gy
    fb, ff = rig.foot_drop["b"], rig.foot_drop["f"]
    AB, AF = J["ankle_b"], J["ankle_f"]
    hc = rig.hipc
    rest_arm = rig.rest["arm"]
    F = {}

    # idle: guard pose of the reference, subtle breathing (hips sink 0..3 px, arm sways)
    for i, (dy, da) in enumerate([(0, 0), (1.5, -1.5), (3, -3), (1.5, -1.5)]):
        F["idle_%d" % i] = dict(body=(0, dy), lean=dy * 0.25, arm=rest_arm + da)

    # run: narrow stance, 8-phase gait with IK feet, bounce, forward lean
    cx = hc[0] - 2
    stride = 46
    lift = 30
    hs = {"b": 7, "f": -7}
    for i in range(8):
        ph = i / 8.0
        feet = {}
        for t, off in (("b", 0.0), ("f", 0.5)):
            p = (ph + off) % 1.0
            drop = rig.foot_drop[t]
            if p < 0.5:      # stance: foot moves from front to back on the ground
                u = p / 0.5
                x = cx + stride * (1 - 2 * u)
                y = gy - drop
            else:            # swing: back to front with lift
                u = (p - 0.5) / 0.5
                x = cx - stride + 2 * stride * (0.5 - 0.5 * math.cos(math.pi * u))
                y = gy - drop - lift * math.sin(math.pi * u)
            feet[t] = (x, y)
        bounce = 2.5 + 2.5 * math.cos(4 * math.pi * ph)     # low at contact
        F["run_%d" % i] = dict(body=(0, 3 + bounce), lean=11, feet=feet, hip_shift=hs,
                               arm=-40 + 14 * math.sin(2 * math.pi * ph))

    # jump (rising): legs tucked, arm up/back
    tuck = {"b": (hc[0] - 22, gy - fb - 40), "f": (hc[0] + 30, gy - ff - 52)}
    F["jump_0"] = dict(body=(-2, -6), lean=4, feet={"b": (hc[0] - 30, gy - fb - 12), "f": (hc[0] + 26, gy - ff - 30)},
                       hip_shift=hs, arm=rest_arm + 25)
    F["jump_1"] = dict(body=(-2, -8), lean=2, feet=tuck, hip_shift=hs, arm=rest_arm + 35)
    # fall: legs reaching down, arm raised for balance
    F["fall_0"] = dict(body=(-2, -6), lean=-2, feet={"b": (hc[0] - 34, gy - fb - 6), "f": (hc[0] + 24, gy - ff - 16)},
                       hip_shift=hs, arm=rest_arm + 45)
    F["fall_1"] = dict(body=(-2, -6), lean=-3, feet={"b": (hc[0] - 36, gy - fb - 2), "f": (hc[0] + 26, gy - ff - 12)},
                       hip_shift=hs, arm=rest_arm + 52)

    # attack: wind-up (arm back & up), swing over, extend forward at shoulder height, recover
    F["attack_0"] = dict(body=(-6, 2), lean=-6, arm=-128)                              # wind-up: hand back/up
    F["attack_1"] = dict(body=(0, 0), lean=0, arm=-172, arm_front=True, sh_shift=(4, 2))  # overhead swing
    F["attack_2"] = dict(body=(10, 4), lean=8, arm=84, arm_front=True, sh_shift=(14, 12))  # extended forward
    F["attack_3"] = dict(body=(8, 3), lean=6, arm=72, arm_front=True, sh_shift=(12, 12))   # follow-through

    # dash: whole lunge pose leaned forward, low
    F["dash_0"] = dict(body=(10, 12), lean=14, feet={"b": (AB[0] - 8, gy - fb), "f": (AF[0] + 6, gy - ff)},
                       arm=rest_arm - 6)
    F["dash_1"] = dict(body=(16, 16), lean=20, feet={"b": (AB[0] - 10, gy - fb - 3), "f": (AF[0] + 12, gy - ff)},
                       arm=rest_arm - 12)

    # crouch: hips dropped, knees deeply bent
    F["crouch_0"] = dict(body=(6, 40), lean=8, feet={"b": (hc[0] - 34, gy - fb), "f": (AF[0] - 2, gy - ff)},
                         hip_shift={"b": 6, "f": -4}, arm=rest_arm + 12)
    return F


ANIMS = {
    "idle": (["idle_%d" % i for i in range(4)], 6, True),
    "run": (["run_%d" % i for i in range(8)], 12, True),
    "jump": (["jump_0", "jump_1"], 10, False),
    "fall": (["fall_0", "fall_1"], 8, True),
    "attack": (["attack_%d" % i for i in range(4)], 16, False),
    "dash": (["dash_0", "dash_1"], 12, False),
    "crouch": (["crouch_0"], 1, False),
}


def build():
    rig = Rig()
    F = frames_def(rig)
    order = [f for a in ANIMS.values() for f in a[0]]
    full = {}
    for name in order:
        img, hand = rig.pose(**F[name])
        full[name] = (img, hand)

    # anchor: feet centre-bottom. use x of hip centre at rest + ground line, fixed for all frames
    ax_full = rig.hipc[0] + 4
    ay_full = rig.gy
    # common cell from the union bbox of all frames
    ys, xs = [], []
    for img, _ in full.values():
        a = img[..., 3] > 8
        yy, xx = np.where(a)
        ys += [yy.min(), yy.max()]
        xs += [xx.min(), xx.max()]
    pad = 4
    x0 = min(xs) - pad
    x1 = max(xs) + pad
    y0 = min(ys) - pad
    y1 = max(max(ys), int(ay_full)) + pad
    # make dims even so that 0.5 scale is exact
    if (x1 - x0) % 2:
        x1 += 1
    if (y1 - y0) % 2:
        y1 += 1
    x0, x1, y0, y1 = int(x0), int(x1), int(y0), int(y1)
    cw, ch = (x1 - x0) // 2, (y1 - y0) // 2

    cols = 8
    rows = math.ceil(len(order) / cols)
    sheet = np.zeros((rows * ch, cols * cw, 4), np.uint8)
    meta = {}
    for i, name in enumerate(order):
        img, hand = full[name]
        crop = img[y0:y1, x0:x1]
        small = resize_rgba(crop, cw, ch)
        small[small[..., 3] < 6] = 0
        r, c = divmod(i, cols)
        sheet[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] = small
        meta[name] = dict(x=int(c * cw), y=int(r * ch), w=int(cw), h=int(ch),
                          ax=int(round((ax_full - x0) * SC)), ay=int(round((ay_full - y0) * SC)),
                          hx=int(round((hand[0] - x0) * SC)), hy=int(round((hand[1] - y0) * SC)))
    save("hero_sheet.png", sheet)
    js = {"image": "hero_sheet.png", "frames": meta,
          "anims": {k: {"frames": v[0], "fps": v[1], "loop": v[2]} for k, v in ANIMS.items()},
          "facing": "right"}
    with open(os.path.join(OUT, "hero_sheet.js"), "w") as f:
        f.write("// generated by tools/build_hero.py — do not edit by hand\n")
        f.write("window.HERO_SHEET = " + json.dumps(js, indent=1) + ";\n")
    previews(sheet, meta, cw, ch)
    return sheet.shape[1], sheet.shape[0], cw, ch, meta


def previews(sheet, meta, cw, ch):
    # all animations side by side (one row per anim), 2x, checkerboard, anchor + hand markers
    S = 2
    rows = []
    maxn = max(len(v[0]) for v in ANIMS.values())
    W = maxn * cw * S
    can = np.zeros((len(ANIMS) * ch * S, W, 4), np.uint8)
    can[:] = checker(W, can.shape[0], 8)
    for r, (an, (fr, _, _)) in enumerate(ANIMS.items()):
        for c, n in enumerate(fr):
            m = meta[n]
            cell = sheet[m["y"]:m["y"] + ch, m["x"]:m["x"] + cw]
            big = cv2.resize(cell, (cw * S, ch * S), interpolation=cv2.INTER_NEAREST)
            sub_ = can[r * ch * S:(r + 1) * ch * S, c * cw * S:(c + 1) * cw * S]
            sub_[:] = over(sub_, big)
            cv2.line(sub_, (0, m["ay"] * S), (cw * S - 1, m["ay"] * S), (60, 200, 60, 255), 1)
            cv2.circle(sub_, (m["ax"] * S, m["ay"] * S), 3, (0, 255, 0, 255), -1)
            cv2.circle(sub_, (m["hx"] * S, m["hy"] * S), 3, (255, 220, 0, 255), -1)
            cv2.rectangle(sub_, (0, 0), (cw * S - 1, ch * S - 1), (120, 120, 120, 255), 1)
        cv2.putText(can, an, (4, r * ch * S + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255, 255), 1)
    Image.fromarray(can).save(os.path.join(TOOLS, "preview_hero.png"))
    # GIF strips for run and attack (with a fake whip line from the hand for attack)
    for an in ("run", "attack", "idle"):
        frs = []
        for n in ANIMS[an][0]:
            m = meta[n]
            cell = sheet[m["y"]:m["y"] + ch, m["x"]:m["x"] + cw]
            bg = np.zeros((ch, cw, 4), np.uint8)
            bg[..., :3] = (38, 44, 66)
            bg[..., 3] = 255
            f = over(bg, cell)
            cv2.line(f, (0, m["ay"]), (cw, m["ay"]), (90, 90, 110, 255), 1)
            f = cv2.resize(f, (cw * 3, ch * 3), interpolation=cv2.INTER_NEAREST)
            frs.append(Image.fromarray(f[..., :3]))
        dur = int(1000 / ANIMS[an][1])
        frs[0].save(os.path.join(TOOLS, "preview_%s.gif" % an), save_all=True, append_images=frs[1:],
                    duration=dur, loop=0)


if __name__ == "__main__":
    print(build()[:4])
