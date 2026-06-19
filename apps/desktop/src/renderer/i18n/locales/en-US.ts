const messages = {
  common: {
    save: "Save",
    reset: "Reset",
    refresh: "Refresh",
    refreshArrow: "↻ Refresh",
    cancel: "Cancel",
    close: "Close",
    copy: "Copy",
    delete: "Delete",
    undo: "Undo",
    viewAll: "View all →",
    providerNeeded: "Provider needed",
    ready: "Ready",
    loading: "Loading…",
    em: "—",
    filters: "Filters",
    weekday: {
      sun: "Sunday",
      mon: "Monday",
      tue: "Tuesday",
      wed: "Wednesday",
      thu: "Thursday",
      fri: "Friday",
      sat: "Saturday"
    }
  },
  capsule: {
    error: {
      generic: "Not heard",
      missingProvider: "No provider",
      tooShort: "Too short — try again",
      silent: "No sound detected — try again",
      noRecognition: "Couldn't recognize anything — try again"
    },
    aria: {
      idle: "Voice input idle",
      listening: "Listening",
      thinking: "Thinking",
      error: "Not heard"
    },
    cancelFailed: "Could not stop recording.",
    gotIt: "Got it"
  },
  sidebar: {
    home: "Home",
    history: "History",
    modes: "Modes",
    dictionary: "Dictionary",
    models: "Models",
    settings: "Settings",
    helpAria: "Help",
    feedbackAria: "Feedback",
    themeAria: "Theme: {{theme}}",
    languageAria: "Language: {{language}}"
  },
  home: {
    recent: "Recent",
    stats: {
      aria: "Today's stats",
      chars: "Characters",
      sessions: "Sessions",
      avg: "Avg time"
    },
    gesture: {
      hold: "Hold",
      speak: "to speak",
      noHotkey: "Bind a hotkey to start speaking"
    },
    recentRow: {
      justNow: "just now",
      minutesAgo: "{{count}} min ago",
      hoursAgo: "{{count}} h ago",
      daysAgo: "{{count}} d ago",
      unknownApp: "Unknown app"
    },
    readiness: {
      needsAttention: "Needs attention",
      fix: "Fix",
      blocker: {
        missing_provider: "No transcription provider is configured.",
        provider_unverified: "The active provider hasn't been verified yet.",
        missing_mode: "No usable mode is selected.",
        missing_hotkey: "The current mode has no shortcut bound.",
        microphone_permission_denied: "Microphone permission is needed.",
        accessibility_permission_denied: "Accessibility permission is needed.",
        native_runtime_unavailable: "The voice runtime is unavailable."
      }
    }
  },
  history: {
    pageTitle: "History",
    searchAria: "Search history",
    searchPlaceholder: "Search content, mode, provider…",
    searchClose: "Close search",
    filtersAria: "History filters",
    groupTitle: "— History",
    empty: {
      title: "No transcripts yet.",
      body: "Completed, empty, failed, and cancelled sessions will appear here.",
      noMatches: "No matching transcripts."
    },
    raw: "RAW",
    chars: "{{count}} chars",
    statusLabel: {
      completed: "(no content)",
      empty: "(no speech detected)",
      failed: "(failed)",
      cancelled: "(cancelled)"
    },
    rowToolbarSeparator: "·",
    filterAll: "All",
    bucket: {
      today: "Today",
      yesterday: "Yesterday",
      monthDay: "{{month}}/{{day}}"
    },
    copyFailed: "Failed to copy text.",
    clearAll: "Clear all",
    deleteAria: "Delete transcript",
    deleteFailed: "Failed to delete transcript.",
    deletedUndo: "Transcript deleted",
    confirmClear: {
      message: "Clear all history?",
      detail: "This permanently deletes every transcript. This can't be undone."
    }
  },
  modes: {
    title: "Modes",
    newModeDefaultName: "New mode",
    shortcut: "Shortcut",
    shortcutEmpty: "No shortcut",
    shortcutSet: "Set shortcut",
    shortcutButtonAria: "Set shortcut for {{name}}",
    shortcutButtonBoundAria: "Shortcut for {{name}}: {{chord}} (click to change)",
    shortcutPrompt: "Press the modifier keys you want…",
    shortcutSuppressNote: "Other apps' shortcuts are paused",
    shortcutEscHint: "Press Esc to cancel",
    shortcutReleaseHint: "Release to confirm",
    shortcutToggleHint: "Press once to start, again to stop",
    shortcutConfirm: "Confirm",
    shortcutRerecord: "Re-record",
    shortcutCancel: "Cancel",
    shortcutRemove: "Remove shortcut",
    shortcutReplace: "Replace & unbind {{name}}",
    shortcutOnlyModifiers: "Only modifier keys are supported",
    shortcutMaxTwo: "At most two modifiers",
    shortcutTypingWarn: "This key also fires while typing",
    hotkeyConflict: "Conflicts with {{name}} (shared modifier: {{modifiers}})",
    savedToast: "Saved ✓",
    promptTitle: "Prompt",
    promptLoading: "Loading prompt…",
    promptLoadError: "Failed to load prompt.",
    promptRetry: "Retry",
    promptSaveError: "Failed to save prompt.",
    modeSaveError: "Failed to save mode.",
    createError: "Couldn't create the mode",
    deleteError: "Couldn't delete the mode",
    deletedMode: "Deleted mode",
    voiceTab: "Voice modes",
    newModeButton: "New mode",
    nameLabel: "Name",
    namePlaceholder: "Mode name",
    deleteMode: "Delete mode",
    deleteModeConfirm: "Delete “{{name}}”?",
    deleteModeConfirmBody: "This can’t be undone.",
    deleteModeConfirmOk: "Delete",
    deleteModeConfirmCancel: "Cancel",
    identityDictation: "Dictation",
    identityTranslate: "Translate",
    identityCustom: "Custom",
    canonical: {
      default: "Default",
      translate: "Translate"
    }
  },
  dictionary: {
    title: "Dictionary",
    listAria: "Dictionary, {{count}} terms",
    addPlaceholder: "New word",
    hits: "{{count}} uses",
    filter: {
      all: "All",
      auto: "Auto",
      manual: "Manual"
    },
    searchOpenAria: "Search dictionary",
    searchClose: "Close search",
    searchPlaceholder: "Search words",
    addInput: {
      placeholder: "Type a word, press Enter",
      cancelHint: "Press Esc to cancel"
    },
    deleteButtonAria: "Delete \"{{term}}\"",
    confirmDelete: {
      message: "Delete this entry?",
      detail: "This can't be undone.",
      confirm: "Delete",
    },
    msg: {
      empty: "No dictionary entries yet.",
      noMatches: "No matching terms.",
      saveFailed: "Failed to save word.",
      deleteFailed: "Failed to delete word."
    }
  },
  models: {
    title: "Models",
    empty: "No saved model configs yet.",
    col: {
      name: "Name",
      capability: "Capability",
      model: "Model",
      status: "Status",
      verified: "Last verified"
    },
    capability: {
      omni: "Omni",
      asr: "Speech-to-text",
      llm: "Text cleanup"
    },
    vendor: {
      mimo: "MiMo",
      doubaoArk: "Doubao",
      doubaoAsr: "Doubao Speech",
      dashscope: "Qwen",
      dashscopeRealtime: "Qwen Realtime",
      openaiCompat: "OpenAI compatible"
    },
    vendorSource: {
      xiaomi: "Xiaomi",
      bytedance: "ByteDance",
      alibaba: "Alibaba Cloud",
      custom: "Custom endpoint"
    },
    add: "Add config",
    addStepVendor: "Choose a vendor",
    custom: "Custom",
    advanced: "Advanced",
    endpoint: "Endpoint",
    displayName: "Display name",
    apiKey: "API key",
    getApiKey: "Get a key",
    appKey: "App Key",
    accessKey: "Access Key",
    saveAndVerify: "Save & verify",
    saveAndSetActive: "Save & set as current",
    cancel: "Cancel",
    reverify: "Re-verify",
    reverifyPending: "Verification in progress",
    verifyNow: "Verify now",
    inUse: "In use",
    unassigned: "Unassigned",
    default: "Default",
    setActive: "Use for {{slot}}",
    inUseSlot: "In use · {{slot}}",
    dormant: "Unused in this mode",
    clearSlot: "Clear",
    actions: "Config actions",
    selectModel: "Select model",
    edit: "Edit",
    deleteAction: "Delete",
    verifiedAge: {
      now: "Just now",
      minutes: "{{n}}m ago",
      hours: "{{n}}h ago",
      days: "{{n}}d ago"
    },
    delete: {
      confirm: "Delete this config?",
      detailActive:
        "An engine slot uses this config; deleting it leaves the slot unconfigured and blocks dictation.",
      detail: "This cannot be undone."
    }
  },
  settings: {
    page: {
      title: "Settings"
    },
    nav: {
      basics: "BASICS",
      abilities: "ABILITIES",
      system: "SYSTEM",
      microphone: "Microphone",
      permissions: "Permissions",
      network: "Network",
      general: "General",
      about: "About"
    },
    placeholder: "Controls reserved for the MVP shell.",
    general: {
      hideIconMac: "Hide Dock icon",
      hideIconWin: "Hide taskbar icon",
      hideIconHint: "Keep Soto out of the Dock or taskbar; reopen it from the menu bar or system tray.",
      hideIconDesc: "Hidden from the Dock or taskbar",
      launchAtLogin: "Launch at login",
      launchAtLoginDesc: "Open Soto automatically after you sign in",
      launchAtLoginHint: "When enabled, Soto starts automatically when you sign in.",
      includeWindowContext: "Send window context",
      includeWindowContextDesc: "Include app name and window title in AI requests",
      includeWindowContextHint: "When off, Soto strips app and window context before sending model requests.",
      textSize: {
        label: "Text size",
        desc: "Display size of interface text",
        small: "Small",
        default: "Default",
        large: "Large"
      }
    },
    microphone: {
      inputDevice: "Input device",
      inputDeviceDesc: "The microphone used for recording",
      systemDefault: "System default",
      defaultSuffix: " · default",
      realtimeLevel: "Realtime level",
      dbReadout: "— dBFS",
      levelHint: "Live readout activates once a recording starts.",
      inputLevel: "Input level",
      saveFailed: "Failed to save settings."
    },
    engine: {
      mode: {
        aria: "Engine mode",
        omni: "Omni",
        asr_llm: "Two-stage"
      },
      saveFailed: "Couldn't save engine settings.",
      slot: {
        omni: "Omni engine",
        asr: "Speech recognition",
        llm: "Text cleanup",
        modelRequired: "Model is required",
        verifying: "Verifying...",
        apiKeyPlaceholder: "Leave blank to keep existing secret",
        badgeVerified: "✓ Verified · {{ms}}ms",
        badgeUnverified: "○ Not verified",
        badgeFailed: "✕ Verification failed",
        badgeVerifiedAt: "Verified at {{when}}",
        toastSavedOk: "Saved · Verified {{ms}}ms",
        toastSavedVerifyFailed: "Saved, verification failed: {{note}}",
        toastSavedVerifyTimedOut: "Saved, verification timed out after 30s",
        toastSaveFailed: "Save failed: {{note}}",
        catalogLoadFailed: "Failed to load provider list."
      }
    },
    network: {
      useProxy: "Use system proxy",
      useProxyDesc: "Follows HTTPS_PROXY / ALL_PROXY env vars",
      useProxyHint: "When enabled, outgoing requests follow HTTPS_PROXY / ALL_PROXY environment variables."
    },
    about: {
      tagline: "Sotto voce, polished prose.",
      versionLine: "Version {{version}}",
      repositoryLabel: "github.com/cauyxy/sotoapp",
      signature: "Made with 💗 by Xinyu",
      openRepoFailed: "Could not open link."
    }
  },
  onboarding: {
    permissions: {
      refreshStatus: "Refresh status",
      openingAction: "Opening...",
      subtitle: "Soto needs these to record audio and insert text.",
      microphoneTitle: "Microphone",
      microphoneDescription: "Required for recording audio while the hotkey is active.",
      microphoneAction: "Request microphone access",
      microphoneSettingsAction: "Open microphone settings",
      accessibilityTitle: "Accessibility",
      accessibilityDescription: "Required for inserting final text and enabling global shortcuts on macOS.",
      accessibilityAction: "Open accessibility settings",
      action: {
        request: "Request",
        openSettings: "Open settings"
      },
      msg: {
        checking: "Checking permission status.",
        ready: "Permissions are ready.",
        review: "Review any permission marked as Needs review before recording.",
        unavailable: "Permission status is unavailable.",
        refreshHint: "You can refresh after changing OS settings.",
        opened: "Opened system {{pane}} settings.",
        openFailed: "Could not open system settings."
      }
    },
    launch: {
      loading: "Loading Soto settings.",
      ready: "Soto is ready.",
      unavailable: "Settings commands are unavailable.",
      repairData: "Repair data",
      repairConfirm: "Clear local data and restart?",
      repairConfirmDetail:
        "This deletes the local database (history, settings, and saved keys) and relaunches Soto. Other files are kept.",
      repairConfirmAction: "Repair & restart"
    }
  },
};

export default messages;
export type Messages = typeof messages;
