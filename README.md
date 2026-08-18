# pear-runtime-react-native

Native OTA setup for React Native apps. Ships an [Expo](https://expo.dev) config plugin that makes release builds boot a Pear-delivered JS bundle, plus a Metro config helper for building those bundles.

```sh
npm install pear-runtime-react-native
```

There is no runtime API here and nothing to import in app code. The runtime side (storage, bare workers, update flow) is in [pear-mobile](https://github.com/holepunchto/pear-mobile).

## MVP - EXPERIMENTAL

This boilerplate is MVP and Experimental.

## Scope

This package owns exactly two things:

- **Boot control.** An Expo config plugin that patches the generated native projects so release builds choose between the OTA bundle and the bundle shipped in the binary.
- **Metro config.** A helper that merges the React Native and Expo Metro defaults so `npx react-native bundle` produces usable OTA payloads.

Everything else in a working Pear mobile app belongs to other packages: downloading and applying updates is [pear-mobile](https://github.com/holepunchto/pear-mobile) and [pear-runtime-updater](https://github.com/holepunchto/pear-runtime-updater), Bare workers and the Android minimum SDK are [react-native-bare-kit](https://github.com/holepunchto/react-native-bare-kit), and deployment payloads are [pear-build](https://github.com/holepunchto/pear-build) and [`pear`](https://docs.pears.com).

The guide below covers the whole standard integration, because the pieces only work together. Requirements that come from another package are labelled as such, so nothing here is mistaken for a requirement of the OTA plugin itself.

A complete working project is [hello-pear-react-native](https://github.com/holepunchto/hello-pear-react-native), which every command and path in this README was verified against.

## Required packages

```sh
npm install pear-runtime-react-native pear-mobile react-native-bare-kit
npx expo install expo-build-properties
npm install --save-dev @react-native/metro-config @react-native-community/cli
```

- **`pear-mobile`** is the runtime and updater. Not required by boot control, required by every real app.
- **`react-native-bare-kit`** must be declared in the project root so autolinking builds its native module in. That and `expo-build-properties`, which raises the Android minimum SDK to the level Bare Kit needs, are [pear-mobile requirements](https://github.com/holepunchto/pear-mobile#requirements) rather than requirements of the OTA config plugin. They appear here because a working app needs both.
- **`@react-native/metro-config`** is an optional peer of this package and must be installed by the app, at the version matching its React Native. It is deliberately not a hard dependency here so the project keeps control of the version.
- **`@react-native-community/cli`** is required because `npx react-native bundle` in modern React Native only delegates. `react-native/cli.js` resolves `@react-native-community/cli` from the project and throws `react-native/cli is deprecated` when it is absent, which means OTA payloads cannot be built without it.
- **`expo`** is required for the plugin flow even though it is an optional peer. The peer is optional because manual integration in a plain React Native project is also supported.

## Expo setup

The config plugin requires Expo and Prebuild. There is no autolinking path and no runtime patching: the native projects are generated, then patched.

```json
{
  "expo": {
    "plugins": [
      "pear-runtime-react-native/plugin",
      [
        "expo-build-properties",
        {
          "android": {
            "minSdkVersion": 29
          }
        }
      ]
    ],
    "ios": {
      "bundleIdentifier": "com.example.app"
    },
    "android": {
      "package": "com.example.app"
    }
  }
}
```

Then generate the native projects:

```sh
npx expo prebuild
```

The plugin edits two files. In `AppDelegate.swift` it replaces `bundleURL()`. In `MainApplication.kt` it passes `jsBundleFilePath` into `ExpoReactHostFactory.getDefaultReactHost()` and appends the version check helpers. Running it again on an already patched file does nothing. If it cannot find either hook it throws during prebuild, instead of quietly producing a build with no boot control.

For plain React Native projects the native logic has to be integrated by hand, see [Plain React Native](#plain-react-native). `expo-build-properties` does not apply to a manually managed project either; the Android `minSdkVersion` has to be raised directly in `android/build.gradle`.

## Boot control

Release builds load `pear-runtime/ota/app.bundle` only if the `version` in `pear-runtime/ota/package.json` is newer than the installed app version. If it is not newer they load the bundle shipped in the binary. Debug builds always load from Metro.

Where the OTA folder lives, and what the version gets compared against:

- iOS: `<Application Support>/pear-runtime/ota`, compared with `CFBundleShortVersionString`
- Android: `<filesDir>/pear-runtime/ota`, compared with the package `versionName`

Comparison is plain [SemVer 2.0.0](https://semver.org), no extra rules on top. Both sides must be valid SemVer. Anything the spec rejects counts as not newer, so a bad version string just means the app keeps booting the bundle of the app binary (not the OTA one).

- All three parts are required. If the native version is `1.0` no update will ever apply, so `CFBundleShortVersionString` and `versionName` must be set to `1.0.0`.
- Leading zeros (`1.0.01`) and a `v` prefix (`v1.0.0`) are not valid SemVer.
- Prerelease versions work. `1.0.0-rc.2` is newer than `1.0.0-rc.1`, and `1.0.0` is newer than any `1.0.0-*`. Undotted counters are the exception: the spec compares an identifier containing non-digits as a plain string, so `1.0.0-rc10` is **older** than `1.0.0-rc9`. Written as `-rc.10` the number is compared as a number.
- Build metadata is ignored, so `1.0.0+2` is not newer than `1.0.0+1`. It cannot be used to push a new payload on the same version.

## What an OTA may change

> [!IMPORTANT]
> An OTA may change JavaScript and bundled worker code only when that code stays compatible with the exact native modules, native ABI, configuration, and assets shipped in the installed store build.

## Version synchronization

`package.json` `version` must be the single source of truth for all four of:

- the OTA manifest version, which the updater compares
- Expo's `version`
- iOS `CFBundleShortVersionString`
- Android `versionName`

An `app.config.js` keeps the native side in sync, because Expo writes its `version` into both native projects during prebuild:

```js
const app = require('./app.json')
const { version } = require('./package.json')

module.exports = { ...app.expo, version }
```

With this file present, `app.json` reaches Expo only through that `require`, and `package.json` always wins. A `version` key added to `app.json` is silently ignored rather than honoured.

Versions must be valid SemVer and strictly monotonic across native and OTA releases combined:

1. Every OTA version must be greater than the installed native version and greater than every previously published OTA.
2. Every new native release must be greater than every previously published OTA.
3. Never reuse or decrease a published version.

Two independent gates enforce different halves of this, and they are worth keeping apart:

- `pear.json` `updates.minver` is checked by `pear-mobile` before a payload is downloaded and applied. It stops an OTA from reaching a native build that is too old for it, which is the forward direction. See [pear-mobile](https://github.com/holepunchto/pear-mobile#native-compatibility).
- Boot control, in this package, runs on every launch and compares only the installed OTA manifest version against the native version. It never reads `pear.json`, so `minver` plays no part in choosing which bundle boots.

## Metro

Create `metro.config.js` in the project root:

```js
const { getMetroConfig } = require('pear-runtime-react-native/metro-config')
module.exports = getMetroConfig(__dirname)
```

**Options** (second argument):

- `useExpo` merges in `expo/metro-config`. Left unset it defaults to on and is treated as a preference, so a project without Expo installed is simply bundled without that merge. Passing `true` explicitly makes it a requirement, and a missing `expo/metro-config` then throws.
- `useSentry` merges in `@sentry/react-native/metro`, default `false`. Because it is off by default, passing `true` is always an explicit opt-in and requires `@sentry/react-native` to be installed. A missing one throws.

For plain React Native, either leave `useExpo` unset or turn it off explicitly:

```js
module.exports = getMetroConfig(__dirname, { useExpo: false })
```

> [!NOTE]
> Only an absent module is tolerated, and only for the implied default. A module that is installed but fails to load, or a config generator that throws, always propagates rather than being skipped, so a broken Expo or Sentry integration cannot quietly produce a bundle missing their settings.

Existing custom Metro settings must be merged into the returned config, not used in place of it. Mutating or spreading the nested objects keeps the React Native and Expo defaults that OTA bundling depends on, whereas assigning a fresh `resolver` or `transformer` replaces them:

```js
const path = require('path')
const { getMetroConfig } = require('pear-runtime-react-native/metro-config')

const config = getMetroConfig(__dirname)

config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../shared')]

config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...config.resolver.extraNodeModules,
    '@app': path.resolve(__dirname, 'src')
  }
}

config.transformer = {
  ...config.transformer,
  minifierConfig: { compress: { drop_console: true } }
}

module.exports = config
```

Add `@react-native/metro-config` to the project devDependencies, at the version matching the project React Native. Then `npx react-native bundle` works for OTA payloads.

```sh
npm install @react-native/metro-config --save-dev
```

### Bundling for OTA

With that config in place, the bundle for a payload is produced with the React Native CLI, once per platform, into a directory named exactly `productName`:

```sh
npx react-native bundle --platform ios --dev false --entry-file index.js \
  --bundle-output out/ios/ExampleApp/app.bundle --assets-dest out/ios/ExampleApp
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output out/android/ExampleApp/app.bundle --assets-dest out/android/ExampleApp
```

Assembling those directories into a deployment folder is `pear-build`'s job, see [pear-mobile](https://github.com/holepunchto/pear-mobile#building-the-payload).

## Getting a payload onto the device

Boot control only chooses between bundles that are already on the device. Delivering one is handled elsewhere, and is documented in [pear-mobile](https://github.com/holepunchto/pear-mobile#making-updates):

- `package.json` `productName`, `upgrade`, and `version`, and what the updater requires of each
- the `by-arch/<host>/app/<productName>` payload layout, and the hosts a payload has to cover
- `pear.json` `updates.minver`, which keeps a payload away from a native build too old for it
- bundling the Bare worker, including EAS builds
- staging and seeding the upgrade drive

Staging, provisioning, and multisig are covered by the [hello-pear-react-native guide](https://github.com/holepunchto/hello-pear-react-native#deployments) and the [Pear docs](https://docs.pears.com).

The one part of that flow which crosses into this package is the pair of files boot control reads. Applying an update leaves `app.bundle` and `package.json` together in `pear-runtime/ota`, and the native code needs both: no manifest means no version to compare, which means the shipped bundle is used. A custom downloader has to preserve that pair.

## Prebuild and testing

Regenerate the native projects after anything that changes generated native code:

```sh
npx expo prebuild --clean
```

That includes installing or updating native dependencies, changing or adding config plugins, upgrading Expo, and upgrading this package. `--clean` replaces the generated native directories, so any hand edits inside `ios/` or `android/` are lost.

> [!IMPORTANT]
> Upgrading `pear-runtime-react-native` on its own does not refresh already generated native code. The plugin skips files that already contain its marker, so a project with an `ios/` or `android/` folder from an older version keeps the old boot logic until a clean prebuild runs.

OTA behavior must be tested in a Release build. Debug builds always load from Metro, so a debug run proves nothing about bundle selection.

## Runtime behavior

Applying an update writes the new bundle and its manifest into `pear-runtime/ota`. It does not switch the running app over. Activation happens at the next native bundle selection:

- iOS re-reads `bundleURL()` on reload, so a JavaScript reload can pick up a freshly applied OTA.
- Android captures `jsBundleFilePath` when the React host is created and caches that host, so a JavaScript reload generally reuses the old path and the update takes effect after a full process restart.

Treating a full restart as the requirement on both platforms is the safe assumption.

## Plain React Native

The plugin only works with Expo. It runs as an Expo config mod, and the Android patch looks for `ExpoReactHostFactory`. Without Expo the same changes have to be applied to the `ios/` and `android/` projects by hand:

- iOS: override `bundleURL()` in `AppDelegate`. Return `<Application Support>/pear-runtime/ota/app.bundle` if it exists and its `package.json` `version` is newer than `CFBundleShortVersionString`, otherwise return the shipped `main.jsbundle`.
- Android: override `getJSBundleFile()` on the `ReactNativeHost`. Return `<filesDir>/pear-runtime/ota/app.bundle` under the same condition, otherwise `null`.

The Swift and Kotlin the plugin generates lives in `lib/ota-templates.js` and can be used for reference.

## Conflicts and expectations

The automated plugin expects the stock Expo templates:

- a Swift `AppDelegate` containing `bundleURL()`
- a Kotlin `MainApplication` using `ExpoReactHostFactory.getDefaultReactHost()`

Custom or older templates (an Objective-C `AppDelegate`, a Java `MainApplication`, a hand-written React host) need manual adaptation. The plugin throws during prebuild rather than guessing.

> [!WARNING]
> The iOS patch replaces the entire `bundleURL()` implementation, and the Android patch adds its own `jsBundleFilePath`. This conflicts with anything else that selects the JS bundle, including Expo Updates, Sentry bundle handling, and other OTA systems. An app should have exactly one explicit owner of bundle selection, and the generated native files are worth inspecting after prebuild to confirm which one won.

## Exports

#### `pear-runtime-react-native/plugin`

Expo config plugin. Goes in `expo.plugins`, not called directly.

#### `const { getMetroConfig } = require('pear-runtime-react-native/metro-config')`

Metro config factory, see [Metro](#metro).

## License

Apache-2.0
