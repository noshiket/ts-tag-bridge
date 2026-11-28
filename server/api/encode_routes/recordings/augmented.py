"""録画結果の一覧と1件（確定値・ドロップの要約を添えた形）"""

import json
from quart import jsonify, request, abort
from api.routes.auth import bp, perm, require_screen
from api.routes.rec_aug import _build_rec_aug_result


def _cv_present(v):
    """確定値（list or スカラー）が非空か。list は全要素空なら空扱い。"""
    if isinstance(v, list):
        return any(x not in (None, '') for x in v)
    return v not in (None, '')


@bp.get('/recordings/augmented/<int:db_rec_id>')
def get_recording_augmented(db_rec_id):
    """db_rec_id（recordings.id）で単一の録画結果(augmented)を返す。エンコード進捗→録画詳細リンク用。"""
    for r in _build_rec_aug_result():
        if r.get('db_rec_id') == db_rec_id:
            return jsonify(r)
    abort(404, description='録画が見つかりません')


def _slim_drop_error(raw):
    """一覧用に drop_error の errors[] / scramble_ranges を落とし、集計値だけ残す。

    errors は1件で1MBを超えることがある(実測: 20件の一覧 1.70MB のうち 1.24MB が
    1録画分の errors)。一覧は件数しか使わない。位置まで要る画面(分割情報・分割エディタ)は
    /recordings/augmented/<db_rec_id> で全部取れるのでそちらへ回す。
    drop_count はクライアントと同じ規則で数え直す(errors が空だと集計値へフォールバック
    するため、元の集計値をそのまま返すと食い違う古いデータで件数が変わってしまう)。
    """
    from db.video_db.common import drop_scramble_counts

    if not raw:
        return raw
    try:
        d = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return raw
    if not isinstance(d, dict):
        return raw
    drop, scramble = drop_scramble_counts(d)
    return {'total_packets': d.get('total_packets'),
            'drop_count': drop, 'scramble_count': scramble,
            'other_count': d.get('other_count'), 'error_count': d.get('error_count'),
            'errors': [], 'scramble_ranges': [], 'slim': True}


@bp.get('/recordings/augmented')
def list_recordings_augmented():
    """EDCB録画結果一覧 + rule_db の tags / action を結合して返す。手動登録も含む。"""
    page         = int(request.args.get('page', 0))
    per_page     = int(request.args.get('per_page', 20))
    f_station    = request.args.get('station', '')
    f_date       = request.args.get('date', '')
    f_folder     = request.args.get('folder', 'all')
    f_ep         = request.args.get('ep', 'all')
    f_rec_status = request.args.get('rec_status', '')
    f_parser_err = request.args.get('parser_err', 'all')
    f_file_exist = request.args.get('file_exist', 'all')
    f_drop       = request.args.get('drop', 'all')
    f_state      = request.args.get('state', 'all')
    f_genre      = request.args.get('genre', '')
    f_q          = request.args.get('q', '')

    require_screen('recresult')
    # 許可外の局はここで落とす。summary もこの後で数えるので件数がズレない
    result = perm().filter_items(_build_rec_aug_result())

    # --- summary（フィルタ前の全件集計）---
    def _ep_kind(r):
        ep = (r.get('confirmed') or {}).get('episode_number')
        if ep is None or ep == '': return 'none'
        if isinstance(ep, list): return 'multi' if len(ep) >= 2 else 'single'
        return 'single'

    def _has_pkt_loss(r):
        de = r.get('drop_error')
        if not de: return False
        if isinstance(de, str):
            import json as _j2
            try: de = _j2.loads(de)
            except Exception: return False
        if 'drop_count' in de:
            return de['drop_count'] > 0
        return any(e.get('error_type') == 'PACKET_LOSS' for e in (de.get('errors') or []))

    def _major_genres(r):
        """eit_genre から大分類のみ（カンマ区切り複数対応、重複なし）"""
        g = r.get('eit_genre') or ''
        out = []
        for part in g.split(','):
            m = part.split('>')[0].strip()
            if m and m not in out:
                out.append(m)
        return out

    stn_cnt, rs_cnt, st_cnt, g_cnt = {}, {}, {}, {}
    fld_w = fld_wo = ep_m = ep_s = ep_n = pe_y = pe_n_ = fe_y = fe_n_ = fe_nl = dr_y = dr_n_ = 0
    for r in result:
        sn = r.get('service_name') or ''
        if sn: stn_cnt[sn] = stn_cnt.get(sn, 0) + 1
        rs = r.get('rec_status')
        if rs is not None: rs_cnt[str(rs)] = rs_cnt.get(str(rs), 0) + 1
        st = r.get('state')
        if st: st_cnt[st] = st_cnt.get(st, 0) + 1
        if _cv_present((r.get('confirmed') or {}).get('folder')): fld_w += 1
        else: fld_wo += 1
        ek = _ep_kind(r)
        if ek == 'multi': ep_m += 1
        elif ek == 'single': ep_s += 1
        else: ep_n += 1
        if r.get('parser_error'): pe_y += 1
        else: pe_n_ += 1
        fe = r.get('file_exist')
        if fe is None: fe_nl += 1
        elif fe: fe_y += 1
        else: fe_n_ += 1
        if _has_pkt_loss(r): dr_y += 1
        elif r.get('drop_error') is not None: dr_n_ += 1
        for gg in _major_genres(r):
            g_cnt[gg] = g_cnt.get(gg, 0) + 1

    summary = {
        'stations': stn_cnt, 'rec_statuses': rs_cnt, 'states': st_cnt, 'genres': g_cnt,
        'folder_with': fld_w, 'folder_without': fld_wo,
        'ep_multi': ep_m, 'ep_single': ep_s, 'ep_none': ep_n,
        'parser_err_yes': pe_y, 'parser_err_no': pe_n_,
        'file_exist_yes': fe_y, 'file_exist_no': fe_n_, 'file_exist_null': fe_nl,
        'drop_yes': dr_y, 'drop_no': dr_n_,
    }

    # --- フィルタ ---
    filtered = result
    if f_station:
        filtered = [r for r in filtered if r.get('service_name') == f_station]
    if f_date:
        filtered = [r for r in filtered if (r.get('start_time') or '').startswith(f_date)]
    if f_folder == 'with':
        filtered = [r for r in filtered if _cv_present((r.get('confirmed') or {}).get('folder'))]
    elif f_folder == 'without':
        filtered = [r for r in filtered if not _cv_present((r.get('confirmed') or {}).get('folder'))]
    if f_ep != 'all':
        filtered = [r for r in filtered if _ep_kind(r) == f_ep]
    if f_rec_status:
        try:
            _rsv = int(f_rec_status)
            filtered = [r for r in filtered if r.get('rec_status') == _rsv]
        except ValueError:
            pass
    if f_parser_err == 'yes':
        filtered = [r for r in filtered if r.get('parser_error')]
    elif f_parser_err == 'no':
        filtered = [r for r in filtered if not r.get('parser_error')]
    if f_file_exist == 'yes':
        filtered = [r for r in filtered if r.get('file_exist') is not None and r.get('file_exist')]
    elif f_file_exist == 'no':
        filtered = [r for r in filtered if r.get('file_exist') is not None and not r.get('file_exist')]
    elif f_file_exist == 'unscanned':
        filtered = [r for r in filtered if r.get('file_exist') is None]
    if f_drop == 'yes':
        filtered = [r for r in filtered if _has_pkt_loss(r)]
    elif f_drop == 'no':
        filtered = [r for r in filtered if r.get('drop_error') is not None and not _has_pkt_loss(r)]
    if f_state != 'all':
        filtered = [r for r in filtered if r.get('state') == f_state]
    if f_genre:
        filtered = [r for r in filtered if f_genre in _major_genres(r)]
    if f_q:
        ql = f_q.lower()
        filtered = [r for r in filtered if ql in (r.get('title') or '').lower() or ql in (r.get('service_name') or '').lower()]

    total = len(filtered)
    start = page * per_page
    # キャッシュ済みの元データは壊さずコピーして、重い drop_error だけ落とす
    items = [dict(r, drop_error=_slim_drop_error(r.get('drop_error')))
             for r in filtered[start:start + per_page]]
    return jsonify({'items': items, 'total': total, 'page': page, 'per_page': per_page, 'summary': summary})
