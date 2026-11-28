"""CM 解析のアドオンを掛ける（話の区間・局の番号）"""

def recording_segments(recording, episode_count, duration_sec):
    """話ごとの時間区間をアドオンに尋ねる。無ければ None（コアの計算を使う）。

    コアは放送枠を話数で割って境界を出すが、CM を捨てて録る取り込みでは
    中身が枠より短く、その割り方が合わない（実測: 10時間枠に対し
    中身 7時間52分。30分刻みだと 08:00 以降がファイルの外を指し、分割画面が
    黒くなる）。取り込みの実際の話の長さはアドオンが知っている。
    """
    for schema in list_addons(target='cm_analysis', only_enabled=True):
        if schema.get('error'):
            continue
        name = schema.get('name')
        try:
            mod, sch, _ = load_addon(name, target='cm_analysis')
            fn = getattr(mod, 'segments', None)
            if fn is None:
                continue
            from logic.addons import addon_events  # noqa: F401
            from logic.addons import addon_settings
            conf = addon_settings.load_settings(
                name, addon_settings.default_enabled('cm_analysis'))
            params = {p['key']: p.get('default') for p in sch['params']}
            params.update(conf['params'])
            got = fn(recording, episode_count, duration_sec, params)
        except Exception as e:
            logger.warning('アドオン %s から区間を取れません(無視): %s', name, e)
            continue
        if got:
            logger.info('アドオン %s が区間 %d 件を示しました', name, len(got))
            return got
    return None
from .loader import list_addons, load_addon
from .discovery import logger


def cm_analysis_service_id(recording):
    """CM解析に使うチャンネル設定の SID をアドオンに尋ねる。無ければ None。

    配信の取り込みには放送の serviceId が無い。アドオンは「ロゴなしで登録した局」の
    設定を借りて解析する仕組みを持っているので、その SID をここで教えてもらう。
    録画登録時はアドオン自身が解析を回すので効かないが、分割画面の「CM解析」ボタン
    から掛け直す時はコアが SID を決めるため、この口が無いと
    「SID9000 のチャンネル設定が Amatsukaze にありません」で失敗する。
    """
    from logic.addons import addon_events  # noqa: F401
    from logic.addons import addon_settings
    for schema in list_addons(target='cm_analysis', only_enabled=True):
        if schema.get('error'):
            continue
        name = schema.get('name')
        try:
            mod, sch, _ = load_addon(name, target='cm_analysis')
            fn = getattr(mod, 'service_id', None)
            if fn is None:
                continue
            conf = addon_settings.load_settings(
                name, addon_settings.default_enabled('cm_analysis'))
            params = {p['key']: p.get('default') for p in sch['params']}
            params.update(conf['params'])
            got = fn(recording, params)
        except Exception as e:
            logger.warning('アドオン %s から解析用SIDを取れません(無視): %s', name, e)
            continue
        if got:
            logger.info('アドオン %s が解析用SID %s を示しました', name, got)
            return int(got)
    return None


def run_cm_analysis(result, recording, ts_path, log=None):
    """CM解析の結果を target='cm_analysis' のアドオンへ通す。

    アドオンは result(dict) を受け取り、直したものを返す。返さなければ素通り。
    落ちても元の結果をそのまま返す（解析を巻き添えにしない）。

    使いどころは、録画の素性によって解析結果の直しが要る場合。たとえば配信の
    取り込みは CM のセグメントを捨てて録るので PTS に穴が残り、フレーム番号を
    PTS で秒へ直すと穴のぶんだけ位置が後ろへずれる。素性は recordings.addon で
    判別できるので、コアは口だけ用意して中身はアドオンに置く。
    """
    from logic.addons import addon_events
    from logic.addons import addon_settings
    for schema in list_addons(target='cm_analysis', only_enabled=True):
        if schema.get('error'):
            continue
        name = schema.get('name')
        try:
            mod, sch, _ = load_addon(name, target='cm_analysis')
            conf = addon_settings.load_settings(
                name, addon_settings.default_enabled('cm_analysis'))
            params = {p['key']: p.get('default') for p in sch['params']}
            params.update(conf['params'])
            ctx = addon_events.EventAddonContext(
                name, 'cm_analysis',
                {'result': result, 'recording': recording, 'ts_path': ts_path,
                 'recording_id': (recording or {}).get('id'),
                 'addon': (recording or {}).get('addon')})
            got = mod.run(ctx, params)
        except Exception as e:
            logger.warning('アドオン %s のCM解析の後処理に失敗(無視): %s', name, e)
            continue
        if isinstance(got, dict) and got:
            if log:
                log(f'アドオン {name} が CM解析の結果を直しました')
            logger.info('アドオン %s が CM解析の結果を直しました', name)
            result = got
    return result
