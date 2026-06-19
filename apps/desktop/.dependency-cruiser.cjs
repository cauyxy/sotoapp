const featureNames = ["capsule", "dictionary", "history", "home", "modes", "settings"];

module.exports = {
  forbidden: [
    ...featureNames.map((feature) => ({
      name: `${feature}-no-cross-feature-imports`,
      severity: "error",
      from: { path: `^src/renderer/features/${feature}/` },
      to: { path: `^src/renderer/features/(?!${feature}/)` },
    })),
    {
      name: "shared-is-downstream-only",
      severity: "error",
      from: { path: "^src/renderer/shared/" },
      to: { path: "^src/renderer/(app|features)/" },
    },
    {
      name: "features-do-not-import-app-shell",
      severity: "error",
      from: { path: "^src/renderer/features/" },
      to: { path: "^src/renderer/app/" },
    },
    {
      name: "voice-selection-no-native-bridge",
      severity: "error",
      from: { path: "^src/main/(voice|selection-transform)/" },
      to: { path: "@soto/native-bridge" },
    },
    {
      name: "voice-selection-no-concrete-store",
      severity: "error",
      from: { path: "^src/main/(voice|selection-transform)/" },
      to: { path: "^src/main/db/store" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.web.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "module", "browser", "default"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/[^/]+" },
    },
  },
};
