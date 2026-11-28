"""GPU を見て、エンコーダーを勧める。GPU を使う権限（render・video のグループ）も見る。"""

import glob
import grp
import os

# (config の streaming.encoder, install.sh の指定, 説明)
ENCODERS = {
    'QSVEncC':  ('--qsvencc',  'Intel の GPU（Quick Sync Video）'),
    'NVEncC':   ('--nvencc',   'NVIDIA の GPU（NVENC）'),
    'VCEEncC':  ('--vceencc',  'AMD の GPU（VCE / VCN）'),
    'rkmppenc': ('--rkmppenc', 'Rockchip（RK3588 など）'),
    'FFmpeg':   ('',           'GPU を使わない（CPU で変換。遅い）'),
}

# /sys/class/drm/card*/device/vendor の値
_VENDORS = {'0x8086': 'QSVEncC', '0x10de': 'NVEncC', '0x1002': 'VCEEncC'}


def detect() -> list:
    """見つかった GPU に合うエンコーダー（見つかった順・重なりなし）"""
    found = []
    for path in sorted(glob.glob('/sys/class/drm/card*/device/vendor')):
        try:
            enc = _VENDORS.get(open(path).read().strip())
        except OSError:
            continue
        if enc and enc not in found:
            found.append(enc)
    try:
        if b'rockchip' in open('/proc/device-tree/compatible', 'rb').read():
            found.append('rkmppenc')
    except OSError:
        pass
    return found


def missing_groups() -> list:
    """GPU を使うのに要るのに、今の利用者が入っていないグループ"""
    if not glob.glob('/dev/dri/renderD*'):
        return []
    mine = {grp.getgrgid(g).gr_name for g in os.getgroups()}
    need = []
    for name in ('render', 'video'):
        try:
            grp.getgrnam(name)
        except KeyError:
            continue
        if name not in mine:
            need.append(name)
    return need
