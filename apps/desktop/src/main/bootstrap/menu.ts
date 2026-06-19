import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";

// Application menu (native-feel: respect platform conventions + windowing
// keyboard shortcuts). With no Menu set, Electron drops its default menu on a
// packaged build — taking the Edit-menu roles that make Cmd-C/V/X/A/Z work in
// text fields, plus Cmd-W (close), Cmd-M (minimize) and Cmd-Q (quit). Setting
// the standard roles restores all of those without bespoke handlers.

/**
 * Build and install the application menu. The role-based items map straight to
 * the OS shortcuts: `editMenu` -> Undo/Redo/Cut/Copy/Paste/Select-All
 * (Cmd-Z/X/C/V/A), `windowMenu` -> Minimize (Cmd-M) + Close (Cmd-W) + zoom,
 * `appMenu` (macOS only) -> About + Hide + Quit (Cmd-Q).
 */
export interface MenuPorts {
  showPreferences(): void;
}

export function installApplicationMenu(ports: MenuPorts): void {
  const isMac = process.platform === "darwin";
  const aboutItem: MenuItemConstructorOptions = {
    label: "About Soto",
    click: () => app.showAboutPanel(),
  };
  const preferencesItem: MenuItemConstructorOptions = {
    label: "Preferences...",
    accelerator: "CmdOrCtrl+,",
    click: ports.showPreferences,
  };

  const template: MenuItemConstructorOptions[] = [
    // macOS: the app menu (named after the app) owns About/Hide/Quit + Cmd-Q.
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              aboutItem,
              { type: "separator" },
              preferencesItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : ([
          {
            label: "Soto",
            submenu: [
              aboutItem,
              preferencesItem,
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as MenuItemConstructorOptions[])),
    // Edit menu: this is what makes clipboard shortcuts work inside inputs.
    { role: "editMenu" },
    { role: "viewMenu" },
    // Window menu: Cmd-M minimize, Cmd-W close, zoom (and macOS window cycling).
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Soto Help",
          click: () => {
            void shell.openExternal("https://github.com/cauyxy/sotoapp");
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // The custom Soto menu preserves the standard role menus while adding app
  // specific items that route through the typed main process services.
}
