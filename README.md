# pear-runtime-react-native

Native OTA integration for React Native apps: an [Expo](https://expo.dev) config plugin that makes release builds boot a Pear-delivered JS bundle, plus a Metro config helper for producing those bundles.

```sh
npm install pear-runtime-react-native
```

This package is build-time glue only — it has no runtime API and is not imported by app code. The app-side runtime (storage, bare workers, update flow) lives in [pear-mobile](https://github.com/holepunchto/pear-mobile).

## MVP - EXPERIMENTAL

This boilerplate is MVP and Experimental.

## OTA updates

OTA works for **Expo** and **plain React Native**. Native setup differs; Metro and bundling are the same.

### Boot control

Release builds load `pear-runtime/ota/app.bundle` only when the `version` in `pear-runtime/ota/package.json` is newer than the installed app version, otherwise they load the bundle shipped in the binary. Debug builds always load from Metro.

The OTA folder is resolved natively as:

- iOS — `<Application Support>/pear-runtime/ota`, compared against `CFBundleShortVersionString`
- Android — `<filesDir>/pear-runtime/ota`, compared against the package `versionName`

Both versions must be valid SemVer (`major.minor.patch`); anything else is treated as not newer. Prerelease precedence follows SemVer 2.0.0 and build metadata does not affect update ordering.

### Flow: Expo

1. **Native** — In `app.json` / `app.config.js` add the plugin, then run prebuild:

   ```json
   { "expo": { "plugins": ["pear-runtime-react-native/plugin"] } }
   ```

   ```sh
   npx expo prebuild
   ```

   The plugin patches `AppDelegate.swift` (replaces `bundleURL()`) and `MainApplication.kt` (passes `jsBundleFilePath` into `ExpoReactHostFactory.getDefaultReactHost()` and appends the version-gate helpers). It is idempotent — already-patched files are left alone — and it throws during prebuild if either hook cannot be found, rather than silently producing a build without boot control.

   Upgrading from an older generated OTA integration requires one clean regeneration:

   ```sh
   npx expo prebuild --clean
   ```

2. **Metro** and **Create OTA bundle** below.

### Flow: Plain React Native

The plugin is Expo-only: it runs as an Expo config mod and the Android patch targets `ExpoReactHostFactory`. Without Expo, apply the equivalent changes to your `ios/` and `android/` projects by hand:

- iOS — override `bundleURL()` in `AppDelegate` to return `<Application Support>/pear-runtime/ota/app.bundle` when it exists and its `package.json` `version` is newer than `CFBundleShortVersionString`, and the shipped `main.jsbundle` otherwise.
- Android — override `getJSBundleFile()` on your `ReactNativeHost` to return `<filesDir>/pear-runtime/ota/app.bundle` under the same condition, and `null` otherwise.

`lib/ota-templates.js` holds the Swift and Kotlin the plugin generates and can be used as a reference. Then do **Metro** and **Create OTA bundle** below.

### Metro

Create `metro.config.js` in the project root:

```js
const { getMetroConfig } = require('pear-runtime-react-native/metro-config')
module.exports = getMetroConfig(__dirname, { useExpo: true, useSentry: false })
```

**Options** (second argument): `useExpo` — merge in `expo/metro-config` when available (default `true`). `useSentry` — merge in `@sentry/react-native/metro` when available (default `false`).

Add `@react-native/metro-config` to your devDependencies. With Expo, `expo/metro-config` is merged in automatically. Then `npx react-native bundle` works for OTA payloads.

```sh
npm install @react-native/metro-config --save-dev
```

### Create OTA bundle (payload)

From the project root (entry file must match your app, e.g. `index.js`):

```sh
npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output dist/by-arch/<host-arch>/app/app.bundle --assets-dest dist/by-arch/<host-arch>/app
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output dist/by-arch/<host-arch>/app/app.bundle --assets-dest dist/by-arch/<host-arch>/app
cp -f package.json dist/package.json
```

The `version` in that copied `package.json` is what the native boot control compares against, so bump it for every update you seed.

Then stage and seed with `pear` as in your OTA flow.

### App runtime

Fetching and applying updates is app-side and lives in [pear-mobile](https://github.com/holepunchto/pear-mobile) — it writes the new bundle into `pear-runtime/ota` so the next launch picks it up.

## Exports

#### `pear-runtime-react-native/plugin`

Expo config plugin. Add it to `expo.plugins`; it is not called directly.

#### `const { getMetroConfig } = require('pear-runtime-react-native/metro-config')`

Metro config factory, see [Metro](#metro).

## License

Apache-2.0
