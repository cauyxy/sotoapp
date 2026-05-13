const messages = {
  common: {
    save: "Save",
    reset: "Reset",
    refresh: "Refresh",
    refreshArrow: "↻ Refresh",
    cancel: "Cancel",
    copy: "Copy",
    delete: "Delete",
    viewAll: "View all →",
    providerNeeded: "Provider needed",
    ready: "Ready",
    loading: "Loading…",
    em: "—",
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
    cancelFailed: "Could not stop recording."
  },
  sidebar: {
    home: "Home",
    history: "History",
    modes: "Modes",
    dictionary: "Dictionary",
    settings: "Settings",
    helpAria: "Help",
    feedbackAria: "Feedback",
    themeAria: "Theme: {{theme}}"
  },
  home: {
    recent: "Recent",
    recentChars: "{{count}} chars",
    overview: "Overview",
    overviewMeta: "This week · stored locally",
    stats: {
      speakTime: "Speak time",
      speakTimeUnit: "min",
      characters: "Characters",
      charactersUnit: "K · chars",
      timeSaved: "Time saved",
      timeSavedUnit: "hr · min",
      avgPace: "Avg. pace",
      avgPaceUnit: "chars / min"
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
    rowToolbarSeparator: "·",
    filterAll: "All",
    bucket: {
      today: "Today",
      yesterday: "Yesterday",
      monthDay: "{{month}}/{{day}}"
    },
    copyFailed: "Failed to copy text."
  },
  modes: {
    title: "Modes",
    shortcut: "Shortcut",
    shortcutCapture: "Press a new combo…",
    shortcutEmpty: "No shortcut",
    activation: "Activation",
    activationHold: "Hold",
    activationToggle: "Toggle",
    savedToast: "Saved ✓",
    promptTitle: "Prompt",
    promptLoading: "Loading prompt…",
    promptLoadError: "Failed to load prompt.",
    promptRetry: "Retry",
    promptSaveError: "Failed to save prompt.",
    modeSaveError: "Failed to save mode.",
    canonical: {
      default: "Default",
      translate: "Translate"
    }
  },
  dictionary: {
    title: "Dictionary",
    addPlaceholder: "New word",
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
    msg: {
      empty: "No dictionary entries yet.",
      noMatches: "No matching terms.",
      saveFailed: "Failed to save word.",
      deleteFailed: "Failed to delete word."
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
      engine: "Engine",
      network: "Network",
      appearanceLanguage: "Appearance & Language",
      about: "About"
    },
    placeholder: "Controls reserved for the MVP shell.",
    microphone: {
      inputDevice: "Input device",
      systemDefault: "System default",
      defaultSuffix: " · default",
      realtimeLevel: "Realtime level",
      dbReadout: "— dBFS",
      levelHint: "Live readout activates once a recording starts.",
      inputLevel: "Input level",
      saveFailed: "Failed to save settings."
    },
    engine: {
      groupTitle: "Engine",
    slot: {
        omni: "Omni model",
        provider: "Provider",
        model: "Model",
        modelRecommendations: "Recommended models",
        modelRequired: "Model is required",
        apiKey: "API key",
        apiKeyPlaceholder: "Leave blank to keep existing secret",
        endpoint: "Endpoint",
        endpointPlaceholder: "Default provider endpoint when blank",
        saveBtn: "Save",
        savingBtn: "Saving...",
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
      useProxyHint: "When enabled, outgoing requests follow HTTPS_PROXY / ALL_PROXY environment variables."
    },
    appearance: {
      theme: "Theme",
      themeSystem: "System",
      themeLight: "Light",
      themeDark: "Dark",
      interfaceLanguage: "Interface language",
      systemLocale: "System",
      saveFailed: "Failed to save settings."
    },
    about: {
      tagline: "Sotto voce, polished prose.",
      versionLine: "Version {{version}}",
      checkUpdate: "Check for updates",
      updateUnavailable: "Auto-update is not configured.",
      updateChecking: "Checking for updates...",
      updateUpToDate: "Soto is up to date.",
      updateAvailable: "Version {{version}} is available.",
      updateInstalling: "Installing update...",
      updateFailed: "Could not check for updates.",
      installUpdate: "Install & Restart",
      updateRetry: "Retry",
      signature: "Made with 💗 by Xinyu",
      openRepoFailed: "Could not open link."
    }
  },
  onboarding: {
    permissions: {
      refreshStatus: "Refresh status",
      openingAction: "Opening...",
      microphoneTitle: "Microphone",
      microphoneDescription: "Required for recording audio while the hotkey is active.",
      microphoneAction: "Request microphone access",
      microphoneSettingsAction: "Open microphone settings",
      accessibilityTitle: "Accessibility",
      accessibilityDescription: "Required for inserting final text and enabling global shortcuts on macOS.",
      accessibilityAction: "Open accessibility settings",
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
      unavailable: "Settings commands are unavailable."
    }
  },
};

export default messages;
export type Messages = typeof messages;
