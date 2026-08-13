# pear-runtime-react-native

Pear runtime for React Native: storage path, bare workers (worklets), and OTA updates.

```sh
npm install pear-runtime-react-native react-native-bare-kit
```

Requires `react-native-bare-kit` in your project.

## MVP - EXPERIMENTAL

This boilerplate is MVP and Experimental.

## Usage

```js
import PearRuntime from 'pear-runtime-react-native'
import bundle from './worker.bundle.js'

const runtime = new PearRuntime()
const IPC = runtime.run('/worker.bundle', bundle)
```

---

## OTA updates

OTA works for **Expo** and **plain React Native**. Native setup differs; Metro and JS setup are the same.

### Flow: Expo

1. **Native** — In `app.json` / `app.config.js` add the plugin, then run prebuild:

   ```json
   { "expo": { "plugins": ["pear-runtime-react-native/plugin"] } }
   ```

   ```sh
   npx expo prebuild
   ```

   Release builds load the OTA bundle from `pear-runtime/ota/app.bundle`. If the plugin cannot
   find a place to wire that up it throws during prebuild rather than leaving you with a release
   build that silently ignores updates.

2. **Metro** and **App entry** below.

### Flow: Plain React Native

Apply the same native changes to your `ios/` and `android/` projects manually, then do **Metro**
and **App entry** below.

- **iOS** — override `bundleURL()` in `AppDelegate` to return
  `<Application Support>/pear-runtime/ota/app.bundle` when that file exists, else the bundle
  embedded in the app.
- **Android** — return `<filesDir>/pear-runtime/ota/app.bundle` from `getJSBundleFile()`, and copy
  the APK's embedded `index.android.bundle` to that path on first launch. See
  [Android bundle path](#android-bundle-path) for why the file has to be seeded.

### Android bundle path

On iOS `bundleURL()` is called every time the bundle is loaded, so it can check for an OTA file and
fall back to the embedded one. Android has no equivalent hook: the path is resolved **once**, when
the `ReactHost` (or `ReactInstanceManager`) is built, and the result is kept for the life of the
process. A "use the OTA file if it exists" check would therefore resolve to the embedded bundle on a
freshly installed app and stay there, so the first applied update would never load and the app would
keep offering it after every restart.

Release builds instead always load from `<filesDir>/pear-runtime/ota/app.bundle`, seeded from the
APK's embedded bundle on first launch and re-seeded whenever a new APK is installed. Applying an
update swaps a new bundle into that path and it is picked up on the next reload. The cost is one
extra copy of the JS bundle in app storage.

Note that Android resolves image assets to drawables compiled into the APK, so an OTA payload that
adds or changes images will not pick them up — JS-only changes are fine.

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

Then stage and seed with `pear` as in your OTA flow.

## API

#### `const pear = PearRuntime()`

Create a pear runtime (currently doesnt do anything on its own).

#### `IPC <stream.Duplex> = pear.run(filename, bundle, argv)`

Start a Bare worklet. returns IPC duplex stream.

## License

Apache-2.0
