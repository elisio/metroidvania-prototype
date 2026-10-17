"""Hero extraction + cutout part separation (full reference resolution).

The heroine in the reference faces RIGHT (face, raised guard fist and bent front knee point right;
the whip trails behind her to the left). So no mirroring is needed for a right-facing sheet.
"""
import numpy as np
import cv2
from common import ref_rgb, ref_bgr, poly_mask, grabcut_band, clean_mask, bluish_fringe, push_fill, disk

# crop window of the hero in the reference
X0, Y0, X1, Y1 = 520, 1225, 760, 1515

# hand-traced silhouette (reference coords); GrabCut refines a 3px band around it
HERO_POLY = [(662, 1243), (670, 1238), (690, 1238), (700, 1243), (706, 1252), (706, 1262), (700, 1268), (697, 1275),
             (695, 1284), (690, 1289), (698, 1292), (703, 1298), (706, 1308), (710, 1316), (714, 1312), (716, 1296),
             (718, 1288), (722, 1283), (730, 1281), (736, 1284), (738, 1290), (740, 1300), (738, 1312), (735, 1322),
             (726, 1327), (718, 1338), (712, 1342), (704, 1336), (696, 1330), (688, 1327), (682, 1330), (678, 1338),
             (677, 1350), (677, 1362), (682, 1372), (692, 1374), (700, 1380), (710, 1388), (718, 1396), (722, 1405),
             (724, 1415), (722, 1428), (720, 1450), (718, 1468), (722, 1476), (728, 1484), (736, 1490), (738, 1498),
             (735, 1502), (717, 1502), (712, 1497), (706, 1498), (700, 1502), (698, 1495), (698, 1470), (701, 1450),
             (698, 1430), (694, 1412), (689, 1405), (680, 1400), (665, 1398), (655, 1400), (646, 1402), (643, 1410),
             (635, 1420), (627, 1430), (618, 1440), (608, 1450), (592, 1460), (580, 1470), (574, 1480), (573, 1490),
             (573, 1502), (553, 1502), (553, 1490), (558, 1480), (560, 1470), (565, 1460), (572, 1450), (578, 1440),
             (588, 1430), (598, 1420), (606, 1408), (611, 1396), (614, 1385), (616, 1372), (620, 1362), (624, 1352),
             (630, 1345), (637, 1338), (640, 1330), (641, 1314), (630, 1309), (620, 1313), (610, 1318), (602, 1324),
             (598, 1332), (590, 1336), (580, 1339), (570, 1343), (560, 1348), (553, 1348), (553, 1334), (560, 1328),
             (570, 1323), (580, 1318), (588, 1312), (595, 1308), (605, 1305), (615, 1300), (625, 1293), (635, 1287),
             (642, 1282), (650, 1280), (658, 1277), (660, 1268), (657, 1258), (658, 1250)]

# ---- part polygons (reference coords). Generous; they are intersected with the hero alpha.
ARM_POLY = [(548, 1325), (590, 1300), (630, 1280), (646, 1278), (650, 1290), (648, 1305), (644, 1316),
            (625, 1318), (605, 1328), (590, 1345), (560, 1356), (546, 1356)]
LEG_BACK_POLY = [(604, 1381), (614, 1378), (628, 1380), (640, 1384), (650, 1392), (652, 1404), (640, 1420),
                 (620, 1445), (595, 1462), (582, 1476), (580, 1508), (545, 1508), (548, 1478), (565, 1452),
                 (590, 1425), (602, 1400)]
LEG_FRONT_POLY = [(656, 1384), (668, 1370), (684, 1366), (700, 1374), (716, 1388), (728, 1408), (726, 1440),
                  (722, 1470), (742, 1488), (742, 1508), (694, 1508), (694, 1470), (698, 1440), (692, 1418),
                  (680, 1406), (662, 1404), (654, 1396)]

# ---- joints (reference coords)
SHOULDER = (641, 1296)
HAND = (557, 1340)          # whip grip
HIP_B = (626, 1388)
KNEE_B = (597, 1441)
ANKLE_B = (565, 1482)
FOOT_TOP_B = 1477
HIP_F = (678, 1384)
KNEE_F = (710, 1419)
ANKLE_F = (711, 1477)
FOOT_TOP_F = 1472
GROUND_Y = 1502


def hero_alpha():
    bgr = ref_bgr()[Y0:Y1, X0:X1]
    poly = poly_mask(bgr.shape, HERO_POLY, (X0, Y0))
    m = grabcut_band(bgr, poly, band=3, iters=6)
    m = clean_mask(m, 20)
    m = bluish_fringe(bgr[..., ::-1], m, iters=1, thr=40, vmin=90)
    return m


def _local(p):
    return (p[0] - X0, p[1] - Y0)


def _cap(shape, center, r):
    m = np.zeros(shape[:2], np.uint8)
    cv2.circle(m, (int(round(center[0])), int(round(center[1]))), int(r), 1, -1)
    return m


def _side(shape, a, b, keep_toward):
    """Half-plane mask: points on the side of the line through a (perpendicular to a->b) toward keep_toward."""
    h, w = shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.array(b, np.float32) - np.array(a, np.float32)
    s = (xx - a[0]) * d[0] + (yy - a[1]) * d[1]
    t = (keep_toward[0] - a[0]) * d[0] + (keep_toward[1] - a[1]) * d[1]
    return ((s * np.sign(t)) >= 0).astype(np.uint8)


def _layer(rgb, known, region):
    col = push_fill(rgb, known, region)
    a = (region > 0).astype(np.uint8) * 255
    out = np.dstack([col, a])
    out[a == 0] = 0
    return out


def build_parts():
    """Returns dict of RGBA layers (crop-local coords) and joints (crop-local)."""
    rgb = ref_rgb()[Y0:Y1, X0:X1].copy()
    A = hero_alpha()
    shp = A.shape
    arm = A & poly_mask(shp, ARM_POLY, (X0, Y0))
    legb = A & poly_mask(shp, LEG_BACK_POLY, (X0, Y0))
    legf = A & poly_mask(shp, LEG_FRONT_POLY, (X0, Y0))
    torso = A & (1 - arm) & (1 - legb) & (1 - legf)
    torso = clean_mask(torso, 10)

    J = {k: _local(v) for k, v in dict(shoulder=SHOULDER, hand=HAND, hip_b=HIP_B, knee_b=KNEE_B,
                                          ankle_b=ANKLE_B, hip_f=HIP_F, knee_f=KNEE_F, ankle_f=ANKLE_F).items()}
    gy = GROUND_Y - Y0

    # arm with a shoulder cap (hidden behind the torso)
    arm_region = arm | (_cap(shp, J["shoulder"], 11) & cv2.dilate(arm, disk(14)))
    arm_l = _layer(rgb, arm, arm_region)

    parts = {"torso": np.dstack([rgb, torso * 255]), "arm": arm_l}
    yy, xx = np.mgrid[0:shp[0], 0:shp[1]].astype(np.float32)
    for tag, leg in (("b", legb), ("f", legf)):
        hip, knee, ank = J["hip_" + tag], J["knee_" + tag], J["ankle_" + tag]
        # half leg width at the knee, measured perpendicular to the thigh/shin bisector
        d1 = np.array(hip, np.float32) - knee
        d2 = np.array(ank, np.float32) - knee
        d1 /= np.linalg.norm(d1)
        d2 /= np.linalg.norm(d2)
        axis = d1 - d2
        axis /= np.linalg.norm(axis)
        perp = np.array([-axis[1], axis[0]])
        rel_x, rel_y = xx - knee[0], yy - knee[1]
        along = rel_x * axis[0] + rel_y * axis[1]
        across = rel_x * perp[0] + rel_y * perp[1]
        band = leg.astype(bool) & (np.abs(along) < 1.5)
        R = max(6.0, (across[band].max() - across[band].min()) / 2.0 - 0.5) if band.any() else 9.0
        kc = knee + perp * (across[band].max() + across[band].min()) / 2.0 if band.any() else np.array(knee)
        rel_x, rel_y = xx - kc[0], yy - kc[1]
        dist = np.sqrt(rel_x ** 2 + rel_y ** 2)
        kdisk = (dist <= R)
        # thigh: pixels on the hip side of the knee (projected on the thigh direction), rounded end
        t_th = rel_x * d1[0] + rel_y * d1[1]
        t_sh = rel_x * d2[0] + rel_y * d2[1]
        thigh_px = leg.astype(bool) & (along >= 0)
        shin_px = leg.astype(bool) & (along < 0)
        thigh_end = thigh_px & ~((t_th < 0) & ~kdisk)
        shin_end = shin_px & ~((t_sh < 0) & ~kdisk)
        cap = kdisk & (cv2.dilate(leg, disk(1)).astype(bool) | (dist <= R - 1))
        hip_cap = (_cap(shp, hip, 14) & cv2.dilate(thigh_px.astype(np.uint8), disk(16))).astype(bool)
        thigh_region = thigh_end | cap | hip_cap
        shin_region = shin_end | cap
        ftop = (FOOT_TOP_B if tag == "b" else FOOT_TOP_F) - Y0
        foot_px = shin_px & (yy >= ftop)
        foot_region = foot_px | (_cap(shp, ank, 5) & cv2.dilate(leg, disk(1))).astype(bool)
        shin_region = (shin_region & (yy < ftop)) | (_cap(shp, ank, 6) & cv2.dilate(leg, disk(1))).astype(bool)
        known_sh = leg.astype(bool) & (yy < ftop)
        u8 = lambda m: m.astype(np.uint8)
        parts["thigh_" + tag] = _layer(rgb, u8(leg.astype(bool) & (thigh_px | cap)), u8(thigh_region))
        parts["shin_" + tag] = _layer(rgb, u8(known_sh & (shin_px | cap)), u8(shin_region))
        parts["foot_" + tag] = _layer(rgb, u8(foot_px), u8(foot_region))
        parts["leg_" + tag] = _layer(rgb, leg, u8(leg.astype(bool) | hip_cap))
    return parts, J, gy, A
