// Minimal ambient fallback declaration for '@abandonware/noble'. It is an
// optionalDependency (package.json) -- native, platform-specific, and its `npm install`
// may legitimately fail/be skipped on a given machine (verified empirically during this
// task: `npm view @abandonware/noble os` -> ['darwin','linux','freebsd','win32'], and it
// depends on a native addon built via node-gyp-build). bleSource.ts only ever reaches
// this module through a dynamic `import()` inside a try/catch in start() (never a
// static import), but `tsc` still needs SOME type for that dynamic import expression at
// compile time. The real package does ship its own richer index.d.ts, which TypeScript
// prefers automatically whenever the package is actually present in node_modules (an
// exact-name ambient module declaration like this one is only consulted as a fallback
// when normal module resolution fails) -- so this file exists purely so `npm run
// typecheck` stays green on a machine where the optional dependency didn't install,
// without depending on any particular shape from the real (or absent) package. Every
// value is deliberately typed as `unknown`; bleSource.ts does its own narrow, minimal
// `NobleLike` casting immediately after import rather than trusting these types.
declare module '@abandonware/noble' {
  const noble: unknown;
  export default noble;
}
