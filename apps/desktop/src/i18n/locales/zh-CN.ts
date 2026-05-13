import type { Messages } from "./en-US";

const messages: Messages = {
  common: {
    save: "保存",
    reset: "重置",
    refresh: "刷新",
    refreshArrow: "↻ 刷新",
    cancel: "取消",
    copy: "复制",
    delete: "删除",
    viewAll: "查看全部 →",
    providerNeeded: "需要服务",
    ready: "就绪",
    loading: "加载中…",
    em: "—",
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
    cancelFailed: "无法停止录音。"
  },
  sidebar: {
    home: "主页",
    history: "历史",
    modes: "模式",
    dictionary: "词库",
    settings: "设置",
    helpAria: "帮助",
    feedbackAria: "反馈",
    themeAria: "主题：{{theme}}"
  },
  home: {
    recent: "最近",
    recentChars: "{{count}} 字",
    overview: "总览",
    overviewMeta: "本周 · 数据本地存储",
    stats: {
      speakTime: "听写时长",
      speakTimeUnit: "min",
      characters: "听写字数",
      charactersUnit: "K · 字",
      timeSaved: "节省时间",
      timeSavedUnit: "时 · 分",
      avgPace: "平均速度",
      avgPaceUnit: "字 / 分"
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
    rowToolbarSeparator: "·",
    filterAll: "全部",
    bucket: {
      today: "今天",
      yesterday: "昨天",
      monthDay: "{{month}}月{{day}}日"
    },
    copyFailed: "复制失败。"
  },
  modes: {
    title: "模式",
    shortcut: "快捷键",
    shortcutCapture: "按下新组合…",
    shortcutEmpty: "无快捷键",
    activation: "触发方式",
    activationHold: "长按",
    activationToggle: "切换",
    savedToast: "已保存 ✓",
    promptTitle: "提示词",
    promptLoading: "正在加载提示词…",
    promptLoadError: "提示词加载失败",
    promptRetry: "重试",
    promptSaveError: "提示词保存失败",
    modeSaveError: "模式保存失败",
    canonical: {
      default: "默认",
      translate: "翻译"
    }
  },
  dictionary: {
    title: "词典",
    addPlaceholder: "新词",
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
    msg: {
      empty: "尚无词条。",
      noMatches: "没有匹配的术语。",
      saveFailed: "词条保存失败。",
      deleteFailed: "词条删除失败。"
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
      engine: "引擎",
      network: "网络",
      appearanceLanguage: "外观与语言",
      about: "关于"
    },
    placeholder: "MVP 阶段保留的占位区域。",
    microphone: {
      inputDevice: "输入设备",
      systemDefault: "系统默认",
      defaultSuffix: " · 默认",
      realtimeLevel: "实时电平",
      dbReadout: "— dBFS",
      levelHint: "录音开始后实时数值才会刷新。",
      inputLevel: "输入电平",
      saveFailed: "保存设置失败。"
    },
    engine: {
      groupTitle: "引擎",
    slot: {
        omni: "全模态模型",
        provider: "提供方",
        model: "模型",
        modelRecommendations: "推荐模型",
        modelRequired: "模型不能为空",
        apiKey: "密钥",
        apiKeyPlaceholder: "留空则保留已有密钥",
        endpoint: "接口地址",
        endpointPlaceholder: "留空使用提供方默认地址",
        saveBtn: "保存",
        savingBtn: "保存中…",
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
      useProxyHint: "开启后，网络请求遵循 HTTPS_PROXY / ALL_PROXY 环境变量设置。"
    },
    appearance: {
      theme: "主题",
      themeSystem: "跟随系统",
      themeLight: "亮色",
      themeDark: "暗色",
      interfaceLanguage: "界面语言",
      systemLocale: "跟随系统",
      saveFailed: "保存设置失败。"
    },
    about: {
      tagline: "轻声细语，雅致成文",
      versionLine: "版本 {{version}}",
      checkUpdate: "检查更新",
      updateUnavailable: "暂未配置自动更新",
      updateChecking: "正在检查更新...",
      updateUpToDate: "Soto 已是最新版本。",
      updateAvailable: "版本 {{version}} 已发布。",
      updateInstalling: "正在安装更新...",
      updateFailed: "无法检查更新。",
      installUpdate: "安装并重启",
      updateRetry: "重试",
      signature: "Made with 💗 by Xinyu",
      openRepoFailed: "无法打开链接。"
    }
  },
  onboarding: {
    permissions: {
      refreshStatus: "刷新状态",
      openingAction: "正在打开...",
      microphoneTitle: "麦克风",
      microphoneDescription: "在快捷键激活时录音所必需。",
      microphoneAction: "请求麦克风权限",
      microphoneSettingsAction: "打开麦克风设置",
      accessibilityTitle: "辅助功能",
      accessibilityDescription: "用于将成文写入当前应用，并在 macOS 上启用全局快捷键。",
      accessibilityAction: "打开辅助功能设置",
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
      unavailable: "设置命令不可用。"
    }
  },
};

export default messages;
