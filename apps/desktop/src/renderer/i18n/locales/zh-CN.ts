import type { Messages } from "./en-US";

const messages: Messages = {
  common: {
    save: "保存",
    reset: "重置",
    refresh: "刷新",
    refreshArrow: "↻ 刷新",
    cancel: "取消",
    close: "关闭",
    copy: "复制",
    delete: "删除",
    undo: "撤销",
    viewAll: "查看全部 →",
    providerNeeded: "需要服务",
    ready: "就绪",
    loading: "加载中…",
    em: "—",
    filters: "筛选",
    weekday: {
      sun: "星期日",
      mon: "星期一",
      tue: "星期二",
      wed: "星期三",
      thu: "星期四",
      fri: "星期五",
      sat: "星期六"
    }
  },
  capsule: {
    error: {
      generic: "未听到",
      missingProvider: "未配置",
      tooShort: "录音太短，请重试",
      silent: "未检测到语音，请重试",
      noRecognition: "未识别出内容，请重试"
    },
    aria: {
      idle: "语音输入待命",
      listening: "正在聆听",
      thinking: "正在思考",
      error: "未听到"
    },
    cancelFailed: "无法停止录音。",
    gotIt: "知道了"
  },
  sidebar: {
    home: "主页",
    history: "历史",
    modes: "模式",
    dictionary: "词库",
    models: "模型",
    settings: "设置",
    helpAria: "帮助",
    feedbackAria: "反馈",
    themeAria: "主题：{{theme}}",
    languageAria: "界面语言：{{language}}"
  },
  home: {
    recent: "最近",
    stats: {
      aria: "今日统计",
      chars: "今日字数",
      sessions: "次数",
      avg: "平均时长"
    },
    gesture: {
      hold: "按住",
      speak: "开始说话",
      noHotkey: "先绑定一个快捷键即可开始说话"
    },
    recentRow: {
      justNow: "刚刚",
      minutesAgo: "{{count}} 分钟前",
      hoursAgo: "{{count}} 小时前",
      daysAgo: "{{count}} 天前",
      unknownApp: "未知应用"
    },
    readiness: {
      needsAttention: "需要处理",
      fix: "去处理",
      blocker: {
        missing_provider: "尚未配置转写服务商。",
        provider_unverified: "当前服务商还没有验证。",
        missing_mode: "没有可用的模式被选中。",
        missing_hotkey: "当前模式没有绑定快捷键。",
        microphone_permission_denied: "需要麦克风权限。",
        accessibility_permission_denied: "需要辅助功能权限。",
        native_runtime_unavailable: "语音运行时不可用。"
      }
    }
  },
  history: {
    pageTitle: "历史",
    searchAria: "搜索历史",
    searchPlaceholder: "搜索内容、模式、服务…",
    searchClose: "关闭搜索",
    filtersAria: "历史筛选",
    groupTitle: "— 历史",
    empty: {
      title: "尚无记录",
      body: "已完成、空、失败和取消的会话都会出现在这里。",
      noMatches: "没有匹配的记录。"
    },
    raw: "原文",
    chars: "{{count}} 字",
    statusLabel: {
      completed: "（无内容）",
      empty: "（未识别到内容）",
      failed: "（失败）",
      cancelled: "（已取消）"
    },
    rowToolbarSeparator: "·",
    filterAll: "全部",
    bucket: {
      today: "今天",
      yesterday: "昨天",
      monthDay: "{{month}}月{{day}}日"
    },
    copyFailed: "复制失败。",
    clearAll: "清空全部",
    deleteAria: "删除记录",
    deleteFailed: "删除记录失败。",
    deletedUndo: "记录已删除",
    confirmClear: {
      message: "清空全部历史？",
      detail: "这将永久删除所有记录，且无法撤销。"
    }
  },
  modes: {
    title: "模式",
    newModeDefaultName: "新模式",
    shortcut: "快捷键",
    shortcutEmpty: "无快捷键",
    shortcutSet: "设置快捷键",
    shortcutButtonAria: "设置「{{name}}」的快捷键",
    shortcutButtonBoundAria: "「{{name}}」的快捷键：{{chord}}（点按修改）",
    shortcutPrompt: "按下你想用的修饰键…",
    shortcutSuppressNote: "已临时屏蔽其它应用的快捷键",
    shortcutEscHint: "按 Esc 取消",
    shortcutReleaseHint: "松开以确认",
    shortcutToggleHint: "按一下开始，再按一下结束",
    shortcutConfirm: "确认",
    shortcutRerecord: "重新录制",
    shortcutCancel: "取消",
    shortcutRemove: "移除快捷键",
    shortcutReplace: "替换并解绑「{{name}}」",
    shortcutOnlyModifiers: "只支持修饰键",
    shortcutMaxTwo: "最多两个修饰键",
    shortcutTypingWarn: "这个键打字时也会触发",
    hotkeyConflict: "与「{{name}}」冲突（共享修饰键：{{modifiers}}）",
    savedToast: "已保存 ✓",
    promptTitle: "提示词",
    promptLoading: "正在加载提示词…",
    promptLoadError: "提示词加载失败",
    promptRetry: "重试",
    promptSaveError: "提示词保存失败",
    modeSaveError: "模式保存失败",
    createError: "新建失败",
    deleteError: "删除失败",
    deletedMode: "已删除模式",
    voiceTab: "语音模式",
    newModeButton: "新建模式",
    nameLabel: "名称",
    namePlaceholder: "模式名称",
    deleteMode: "删除模式",
    deleteModeConfirm: "删除「{{name}}」？",
    deleteModeConfirmBody: "此操作不可撤销。",
    deleteModeConfirmOk: "删除",
    deleteModeConfirmCancel: "取消",
    identityDictation: "听写",
    identityTranslate: "翻译",
    identityCustom: "自定义",
    canonical: {
      default: "默认",
      translate: "翻译"
    }
  },
  dictionary: {
    title: "词典",
    listAria: "词库，共 {{count}} 个词",
    addPlaceholder: "新词",
    hits: "{{count}} 次",
    filter: {
      all: "全部",
      auto: "自动",
      manual: "手动"
    },
    searchOpenAria: "搜索词典",
    searchClose: "关闭搜索",
    searchPlaceholder: "搜索词条",
    addInput: {
      placeholder: "输入新词，回车保存",
      cancelHint: "Esc 取消"
    },
    deleteButtonAria: "删除「{{term}}」",
    confirmDelete: {
      message: "删除这个词条？",
      detail: "此操作不可撤销。",
      confirm: "删除",
    },
    msg: {
      empty: "尚无词条。",
      noMatches: "没有匹配的术语。",
      saveFailed: "词条保存失败。",
      deleteFailed: "词条删除失败。"
    }
  },
  models: {
    title: "模型",
    empty: "还没有保存的模型配置。",
    col: {
      name: "名称",
      capability: "能力",
      model: "模型",
      status: "状态",
      verified: "上次验证"
    },
    capability: {
      omni: "全模态",
      asr: "语音识别",
      llm: "文本润色"
    },
    vendor: {
      mimo: "MiMo",
      doubaoArk: "豆包",
      doubaoAsr: "豆包语音",
      dashscope: "通义千问",
      dashscopeRealtime: "通义千问 实时",
      openaiCompat: "OpenAI 兼容"
    },
    vendorSource: {
      xiaomi: "小米",
      bytedance: "ByteDance",
      alibaba: "阿里云",
      custom: "自定义端点"
    },
    add: "添加配置",
    addStepVendor: "选择厂商",
    custom: "自定义",
    advanced: "高级",
    endpoint: "端点",
    displayName: "显示名称",
    apiKey: "API 密钥",
    getApiKey: "获取密钥",
    appKey: "App Key",
    accessKey: "Access Key",
    saveAndVerify: "保存并验证",
    saveAndSetActive: "保存并设为当前使用",
    cancel: "取消",
    reverify: "重新验证",
    reverifyPending: "正在验证中",
    verifyNow: "立即验证",
    inUse: "使用中",
    unassigned: "未指定",
    default: "默认",
    setActive: "设为{{slot}}",
    inUseSlot: "使用中 · {{slot}}",
    dormant: "此模式未使用",
    clearSlot: "清除",
    actions: "配置操作",
    selectModel: "选择模型",
    edit: "编辑",
    deleteAction: "删除",
    verifiedAge: {
      now: "刚刚",
      minutes: "{{n}} 分钟前",
      hours: "{{n}} 小时前",
      days: "{{n}} 天前"
    },
    delete: {
      confirm: "删除该配置？",
      detailActive: "有引擎槽位正在使用该配置；删除后槽位将变为未配置，听写会被阻止。",
      detail: "此操作不可撤销。"
    }
  },
  settings: {
    page: {
      title: "设置"
    },
    nav: {
      basics: "基础",
      abilities: "能力",
      system: "系统",
      microphone: "麦克风",
      permissions: "权限",
      network: "网络",
      general: "通用",
      about: "关于"
    },
    placeholder: "MVP 阶段保留的占位区域。",
    general: {
      hideIconMac: "隐藏程序坞图标",
      hideIconWin: "隐藏任务栏图标",
      hideIconHint: "让 Soto 不出现在程序坞或任务栏；可从菜单栏或系统托盘重新打开。",
      hideIconDesc: "不在程序坞或任务栏显示",
      launchAtLogin: "开机自启动",
      launchAtLoginDesc: "登录系统后自动打开 Soto",
      launchAtLoginHint: "开启后，Soto 会在你登录系统时自动启动。",
      includeWindowContext: "发送窗口上下文",
      includeWindowContextDesc: "在 AI 请求中包含应用名和窗口标题",
      includeWindowContextHint: "关闭后，Soto 会在请求模型前剥离应用和窗口上下文。",
      textSize: {
        label: "文字大小",
        desc: "界面文字的显示大小",
        small: "小",
        default: "默认",
        large: "大"
      }
    },
    microphone: {
      inputDevice: "输入设备",
      inputDeviceDesc: "用于录音的麦克风设备",
      systemDefault: "系统默认",
      defaultSuffix: " · 默认",
      realtimeLevel: "实时电平",
      dbReadout: "— dBFS",
      levelHint: "录音开始后实时数值才会刷新。",
      inputLevel: "输入电平",
      saveFailed: "保存设置失败。"
    },
    engine: {
      mode: {
        aria: "引擎模式",
        omni: "全模态",
        asr_llm: "两阶段"
      },
      saveFailed: "引擎设置保存失败。",
      slot: {
        omni: "全模态引擎",
        asr: "语音识别",
        llm: "文本润色",
        modelRequired: "模型不能为空",
        verifying: "正在验证…",
        apiKeyPlaceholder: "留空则保留已有密钥",
        badgeVerified: "✓ 已验证 · {{ms}}ms",
        badgeUnverified: "○ 未验证",
        badgeFailed: "✕ 验证失败",
        badgeVerifiedAt: "于 {{when}} 验证",
        toastSavedOk: "已保存 · 验证通过 {{ms}}ms",
        toastSavedVerifyFailed: "已保存，验证失败：{{note}}",
        toastSavedVerifyTimedOut: "已保存，验证 30 秒未响应",
        toastSaveFailed: "保存失败：{{note}}",
        catalogLoadFailed: "提供方列表加载失败。"
      }
    },
    network: {
      useProxy: "使用系统代理",
      useProxyDesc: "遵循 HTTPS_PROXY 等环境变量",
      useProxyHint: "开启后，网络请求遵循 HTTPS_PROXY / ALL_PROXY 环境变量设置。"
    },
    about: {
      tagline: "轻声细语，雅致成文",
      versionLine: "版本 {{version}}",
      repositoryLabel: "github.com/cauyxy/sotoapp",
      signature: "Made with 💗 by Xinyu",
      openRepoFailed: "无法打开链接。"
    }
  },
  onboarding: {
    permissions: {
      refreshStatus: "刷新状态",
      openingAction: "正在打开...",
      subtitle: "Soto 需要这些权限来录音和插入文本。",
      microphoneTitle: "麦克风",
      microphoneDescription: "在快捷键激活时录音所必需。",
      microphoneAction: "请求麦克风权限",
      microphoneSettingsAction: "打开麦克风设置",
      accessibilityTitle: "辅助功能",
      accessibilityDescription: "用于将成文写入当前应用，并在 macOS 上启用全局快捷键。",
      accessibilityAction: "打开辅助功能设置",
      action: {
        request: "请求授权",
        openSettings: "打开设置"
      },
      msg: {
        checking: "正在检查权限状态。",
        ready: "权限已就绪。",
        review: "录音前请检查任何「需复核」的权限。",
        unavailable: "无法读取权限状态。",
        refreshHint: "改完系统设置后可点击刷新。",
        opened: "已打开系统 {{pane}} 设置。",
        openFailed: "无法打开系统设置。"
      }
    },
    launch: {
      loading: "加载 Soto 设置。",
      ready: "Soto 已就绪。",
      unavailable: "设置命令不可用。",
      repairData: "修复数据",
      repairConfirm: "清除本地数据并重启？",
      repairConfirmDetail: "将删除本地数据库（历史、设置与已保存的密钥）并重启 Soto，其他文件保留。",
      repairConfirmAction: "修复并重启"
    }
  },
};

export default messages;
