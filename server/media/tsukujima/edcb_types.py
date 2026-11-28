# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project

import datetime
from enum import IntEnum
from typing import NotRequired, TypedDict


# 以下、 CtrlCmdUtil で受け渡しする辞書の型ヒント
# ref: https://github.com/xtne6f/EDCB の Readme_Mod.txt


class SetChInfo(TypedDict, total=False):
    """ チャンネル・ NetworkTV モード変更情報 """
    use_sid: int
    onid: int
    tsid: int
    sid: int
    use_bon_ch: int
    space_or_id: int
    ch_or_mode: int


class ServiceInfo(TypedDict):
    """ サービス情報 """
    onid: int
    tsid: int
    sid: int
    service_type: int
    partial_reception_flag: int
    service_provider_name: str
    service_name: str
    network_name: str
    ts_name: str
    remote_control_key_id: int


class FileData(TypedDict):
    """ 転送ファイルデータ """
    name: str
    data: bytes


class RecFileSetInfo(TypedDict, total=False):
    """ 録画フォルダ情報 """
    rec_folder: str
    write_plug_in: str
    rec_name_plug_in: str

class RecFileSetInfoRequired(TypedDict):
    """ 録画フォルダ情報 (すべてのキーが必須) """
    rec_folder: str
    write_plug_in: str
    rec_name_plug_in: str


class RecSettingData(TypedDict, total=False):
    """ 録画設定 """
    rec_mode: int
    priority: int
    tuijyuu_flag: bool
    service_mode: int
    pittari_flag: bool
    bat_file_path: str
    rec_folder_list: list[RecFileSetInfo]
    suspend_mode: int
    reboot_flag: bool
    start_margin: NotRequired[int]
    end_margin: NotRequired[int]
    continue_rec_flag: bool
    partial_rec_flag: int
    tuner_id: int
    partial_rec_folder: list[RecFileSetInfo]

class RecSettingDataRequired(TypedDict):
    """ 録画設定 (基本すべてのキーが必須) """
    rec_mode: int
    priority: int
    tuijyuu_flag: bool
    service_mode: int
    pittari_flag: bool
    bat_file_path: str
    rec_folder_list: list[RecFileSetInfoRequired]
    suspend_mode: int
    reboot_flag: bool
    start_margin: NotRequired[int]
    end_margin: NotRequired[int]
    continue_rec_flag: bool
    partial_rec_flag: int
    tuner_id: int
    partial_rec_folder: list[RecFileSetInfoRequired]


class ReserveData(TypedDict, total=False):
    """ 予約情報 """
    title: str
    start_time: datetime.datetime
    duration_second: int
    station_name: str
    onid: int
    tsid: int
    sid: int
    eid: int
    comment: str
    reserve_id: int
    overlap_mode: int
    start_time_epg: datetime.datetime
    rec_setting: RecSettingData
    rec_file_name_list: list[str]

class ReserveDataRequired(TypedDict):
    """ 予約情報 (すべてのキーが必須) """
    title: str
    start_time: datetime.datetime
    duration_second: int
    station_name: str
    onid: int
    tsid: int
    sid: int
    eid: int
    comment: str
    reserve_id: int
    overlap_mode: int
    start_time_epg: datetime.datetime
    rec_setting: RecSettingDataRequired
    rec_file_name_list: list[str]


class RecFileInfo(TypedDict, total=False):
    """ 録画済み情報 """
    id: int
    rec_file_path: str
    title: str
    start_time: datetime.datetime
    duration_sec: int
    service_name: str
    onid: int
    tsid: int
    sid: int
    eid: int
    drops: int
    scrambles: int
    rec_status: int
    start_time_epg: datetime.datetime
    comment: str
    program_info: str
    err_info: str
    protect_flag: bool


class TunerReserveInfo(TypedDict):
    """ チューナー予約情報 """
    tuner_id: int
    tuner_name: str
    reserve_list: list[int]


class TunerProcessStatusInfo(TypedDict):
    """ 起動中のチューナー情報 """
    tuner_id: int
    process_id: int
    drop: int
    scramble: int
    signal_lv: float
    space: int
    ch: int
    onid: int
    tsid: int
    rec_flag: bool
    epg_cap_flag: bool
    extra_flags: int


class ShortEventInfo(TypedDict):
    """ イベントの基本情報 """
    event_name: str
    text_char: str


class ExtendedEventInfo(TypedDict):
    """ イベントの拡張情報 """
    text_char: str


class ContentData(TypedDict):
    """ ジャンルの個別データ """
    content_nibble: int
    user_nibble: int


class ContentInfo(TypedDict):
    """ ジャンル情報 """
    nibble_list: list[ContentData]


class ComponentInfo(TypedDict):
    """ 映像情報 """
    stream_content: int
    component_type: int
    component_tag: int
    text_char: str


class AudioComponentInfoData(TypedDict):
    """ 音声情報の個別データ """
    stream_content: int
    component_type: int
    component_tag: int
    stream_type: int
    simulcast_group_tag: int
    es_multi_lingual_flag: int
    main_component_flag: int
    quality_indicator: int
    sampling_rate: int
    text_char: str


class AudioComponentInfo(TypedDict):
    """ 音声情報 """
    component_list: list[AudioComponentInfoData]


class EventData(TypedDict):
    """ イベントグループの個別データ """
    onid: int
    tsid: int
    sid: int
    eid: int


class EventGroupInfo(TypedDict):
    """ イベントグループ情報 """
    group_type: int
    event_data_list: list[EventData]


class EventInfoRequired(TypedDict):
    """ イベント情報の必須項目 """
    onid: int
    tsid: int
    sid: int
    eid: int
    free_ca_flag: int


class EventInfo(EventInfoRequired, total=False):
    """ イベント情報 """
    start_time: datetime.datetime
    duration_sec: int
    short_info: ShortEventInfo
    ext_info: ExtendedEventInfo
    content_info: ContentInfo
    component_info: ComponentInfo
    audio_info: AudioComponentInfo
    event_group_info: EventGroupInfo
    event_relay_info: EventGroupInfo


class ServiceEventInfo(TypedDict):
    """ サービスとそのイベント一覧 """
    service_info: ServiceInfo
    event_list: list[EventInfo]


class SearchDateInfo(TypedDict, total=False):
    """ 対象期間 """
    start_day_of_week: int
    start_hour: int
    start_min: int
    end_day_of_week: int
    end_hour: int
    end_min: int

class SearchDateInfoRequired(TypedDict):
    """ 対象期間 (すべてのキーが必須) """
    start_day_of_week: int
    start_hour: int
    start_min: int
    end_day_of_week: int
    end_hour: int
    end_min: int


class SearchKeyInfo(TypedDict, total=False):
    """ 検索条件 """
    and_key: str
    not_key: str
    key_disabled: bool
    case_sensitive: bool
    reg_exp_flag: bool
    title_only_flag: bool
    content_list: list[ContentData]
    date_list: list[SearchDateInfo]
    service_list: list[int]
    video_list: list[int]
    audio_list: list[int]
    aimai_flag: bool
    not_contet_flag: bool
    not_date_flag: bool
    free_ca_flag: int
    chk_rec_end: bool
    chk_rec_day: int
    chk_rec_no_service: bool
    chk_duration_min: int
    chk_duration_max: int

class SearchKeyInfoRequired(TypedDict):
    """ 検索条件 (すべてのキーが必須) """
    and_key: str
    not_key: str
    key_disabled: bool
    case_sensitive: bool
    reg_exp_flag: bool
    title_only_flag: bool
    content_list: list[ContentData]
    date_list: list[SearchDateInfoRequired]
    service_list: list[int]
    video_list: list[int]
    audio_list: list[int]
    aimai_flag: bool
    not_contet_flag: bool
    not_date_flag: bool
    free_ca_flag: int
    chk_rec_end: bool
    chk_rec_day: int
    chk_rec_no_service: bool
    chk_duration_min: int
    chk_duration_max: int


class AutoAddData(TypedDict, total=False):
    """ 自動予約登録情報 """
    data_id: int
    search_info: SearchKeyInfo
    rec_setting: RecSettingData
    add_count: int

class AutoAddDataRequired(TypedDict):
    """ 自動予約登録情報 (すべてのキーが必須) """
    data_id: int
    search_info: SearchKeyInfoRequired
    rec_setting: RecSettingDataRequired
    add_count: int


class ManualAutoAddData(TypedDict, total=False):
    """ 自動予約 (プログラム) 登録情報 """
    data_id: int
    day_of_week_flag: int
    start_time: int
    duration_second: int
    title: str
    station_name: str
    onid: int
    tsid: int
    sid: int
    rec_setting: RecSettingData


class NWPlayTimeShiftInfo(TypedDict):
    """ CMD_EPG_SRV_NWPLAY_TF_OPEN で受け取る情報 """
    ctrl_id: int
    file_path: str


class NotifySrvInfo(TypedDict):
    """ 情報通知用パラメーター """
    notify_id: int
    time: datetime.datetime
    param1: int
    param2: int
    count: int
    param4: str
    param5: str
    param6: str


class ChSet5Item(TypedDict):
    """ ChSet5.txt の一行の情報 """
    service_name: str
    network_name: str
    onid: int
    tsid: int
    sid: int
    service_type: int
    partial_flag: bool
    epg_cap_flag: bool
    search_flag: bool
    remocon_id: int


class NotifyUpdate(IntEnum):
    """ 通知情報の種類 """
    EPGDATA = 1
    RESERVE_INFO = 2
    REC_INFO = 3
    AUTOADD_EPG = 4
    AUTOADD_MANUAL = 5
    PROFILE = 51
    SRV_STATUS = 100
    PRE_REC_START = 101
    REC_START = 102
    REC_END = 103
    REC_TUIJYU = 104
    CHG_TUIJYU = 105
    PRE_EPGCAP_START = 106
    EPGCAP_START = 107
    EPGCAP_END = 108
