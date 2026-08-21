# pear-runtime-react-native

Native OTA setup for React Native apps. An [Expo](https://expo.dev) config plugin that makes release builds boot a Pear-delivered JS bundle.

```sh
npm install pear-runtime-react-native
```

There is no runtime API here and nothing to import in app code. The runtime side (storage, bare workers, update flow) is in [pear-mobile](https://github.com/holepunchto/pear-mobile).

## MVP - EXPERIMENTAL

This boilerplate is MVP and Experimental.

## Scope

This package owns exactly one thing, **boot control**: an Expo config plugin that patches the generated native projects so release builds choose between the OTA bundle and the bundle shipped in the binary.

Everything else in a working Pear mobile app belongs to [pear-mobile](https://github.com/holepunchto/pear-mobile).

The guide below covers the whole standard integration, because the pieces only work together. Requirements that come from another package are labelled as such, so nothing here is mistaken for a requirement of the OTA plugin itself.

A complete working project is [hello-pear-react-native](https://github.com/holepunchto/hello-pear-react-native).

## Required packages

```sh
npm install pear-runtime-react-native pear-mobile react-native-bare-kit
npx expo install expo-build-properties
```

- **`pear-mobile`** is used to start a bare thread and run the updater in-app.
- **`expo`** is required for the plugin flow even though it is an optional peer. The peer is optional because manual integration in a plain React Native project is also supported.

The packages needed to build a payload, `@react-native/metro-config` and `@react-native-community/cli`, are listed in [pear-mobile](https://github.com/holepunchto/pear-mobile#building-the-payload) with the rest of that flow.

## Expo setup

The config plugin requires Expo and Prebuild. There is no autolinking path and no runtime patching: the native projects are generated, then patched.

inside `app.json`:

```json
{
  "expo": {
    "plugins": [
      "pear-runtime-react-native",
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

The plugin edits two files. In `AppDelegate.swift` it replaces `bundleURL()`. In `MainApplication.kt` it passes `jsBundleFilePath` into `ExpoReactHostFactory.getDefaultReactHost()` and appends the version check helpers.

use the `--clean` flag to re-generate already patched files.

For plain React Native projects the native logic has to be integrated by hand, see [Plain React Native](#plain-react-native). `expo-build-properties` does not apply to a manually managed project either; the Android `minSdkVersion` has to be raised directly in `android/build.gradle`.

## Boot control

Release builds load the downloaded OTA update only if the `version` in of the `package.json` that the OTA was deployed with is newer than the installed app version. If it is not newer they load the bundle shipped in the app's binary. Debug builds always load from Metro.

Where the OTA folder lives, and what the version gets compared against:

- iOS: `<Application Support>/pear-runtime/ota`, compared with `CFBundleShortVersionString`
- Android: `<filesDir>/pear-runtime/ota`, compared with the package `versionName`

Comparison is plain [SemVer 2.0.0](https://semver.org), no extra rules on top. Both sides must be valid SemVer. Anything the spec rejects counts as not newer, so a bad version string just means the app keeps booting the bundle of the app binary (not the OTA one).

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

Versions must be valid SemVer and strictly monotonic across native and OTA releases combined:

1. Every OTA version must be greater than the installed native version and greater than every previously published OTA.
2. Every new native release must be greater than every previously published OTA.
3. Never reuse or decrease a published version.

Two independent gates enforce different halves of this, and they are worth keeping apart:

- `pear.json` `updates.minver` is checked by `pear-mobile` before a payload is downloaded and applied. It stops an OTA from reaching a native build that is too old for it, which is the forward direction. See [pear-mobile](https://github.com/holepunchto/pear-mobile#native-compatibility).
- Boot control, in this package, runs on every launch and compares only the installed OTA manifest version against the native version. It never reads `pear.json`, so `minver` plays no part in choosing which bundle boots.

## Getting a payload onto the device

Boot control only chooses between bundles that are already on the device. Producing and delivering one is handled elsewhere, and is documented in [pear-mobile](https://github.com/holepunchto/pear-mobile#making-updates):

- `package.json` `productName`, `upgrade`, and `version`, and what the updater requires of each
- bundling the app with `npx react-native bundle`, and the Metro config that needs to be in place
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
> Upgrading `pear-runtime-react-native` on its own does not refresh already generated native code, and prebuild will fail until the native projects are regenerated. See [What the plugin will and will not touch](#what-the-plugin-will-and-will-not-touch).

OTA behavior must be tested in a Release build. Debug builds always load from Metro, so a debug run proves nothing about bundle selection.

## Runtime behavior

Applying an update writes the new bundle and its manifest into `pear-runtime/ota`. It does not switch the running app over. Activation happens at the next native bundle selection:

- iOS re-reads `bundleURL()` on reload, so a JavaScript reload can pick up a freshly applied OTA.
- Android captures `jsBundleFilePath` when the React host is created and caches that host, so a JavaScript reload generally reuses the old path and the update takes effect after a full process restart.

Treating a full restart as the requirement on both platforms is the safe assumption.

## What the plugin will and will not touch

The plugin only rewrites the two functions named above and leaves the rest of both files alone. What
it writes is wrapped in comments:

```swift
// !!! REMOVE THIS AND ONLY THIS COMMENT IF YOU EDIT !!!
// pear-runtime-react-native OTA v3
...
// pear-runtime-react-native OTA v3 end
```

> [!WARNING]
> Adopting this plugin in a project that already has its own code in `bundleURL()` or in
> `getDefaultReactHost()` will overwrite it on the next prebuild. The plugin has no way to tell a
> hand-written implementation from the one Expo generates, and it does not try. If something else in
> the project already decides which JS bundle to load, link this by hand instead of adding the
> plugin, using [ota-templates.js](./lib/ota-templates.js) as the reference.

Once linked, a later prebuild reads the version and the edit comment, nothing else:

| What it finds                         | What it does                     |
| ------------------------------------- | -------------------------------- |
| No comments                           | links                            |
| This version                          | nothing, whatever is there stays |
| Another version, edit comment present | replaces the whole block         |
| Another version, edit comment removed | warns, changes nothing           |

So editing the generated code is fine as long as the edit comment goes with it. Keeping the comment
means the block is still the plugin's and will be replaced by the next version; removing it means the
code belongs to the project, and prebuild will only warn that a newer version was not linked. A clean
prebuild takes the new version either way.

Blocks written before the closing marker existed cannot be delimited, so those warn as well and need
`npx expo prebuild --clean`.

## Plain React Native

The plugin only works with Expo. It runs as an Expo config mod, and the Android patch looks for `ExpoReactHostFactory`. Without Expo the same changes have to be applied to the `ios/` and `android/` projects by hand:

- iOS: override `bundleURL()` in `AppDelegate`. Return `<Application Support>/pear-runtime/ota/app.bundle` if it exists and its `package.json` `version` is newer than `CFBundleShortVersionString`, otherwise return the shipped `main.jsbundle`.
- Android: override `getJSBundleFile()` on the `ReactNativeHost`. Return `<filesDir>/pear-runtime/ota/app.bundle` under the same condition, otherwise `null`.

The Swift and Kotlin the plugin generates lives in [ota-templates.js](./lib/ota-templates.js) and can be used for reference.

## Conflicts and expectations

The automated plugin expects the stock Expo templates:

- a Swift `AppDelegate` containing `bundleURL()`
- a Kotlin `MainApplication` using `ExpoReactHostFactory.getDefaultReactHost()`

Custom or older templates (an Objective-C `AppDelegate`, a Java `MainApplication`, a hand-written React host) need manual adaptation.

> [!WARNING]
> The iOS patch replaces the entire `bundleURL()` implementation, and the Android patch adds its own `jsBundleFilePath`. This conflicts with anything else that selects the JS bundle, including Expo Updates, Sentry bundle handling, and other OTA systems. An app should have exactly one explicit owner of bundle selection, and the generated native files are worth inspecting after prebuild to confirm which one won.

## Usage

In `app.json`:

```json
{ "expo": { "plugins": ["pear-runtime-react-native"] } }
```

## License

Apache-2.0
