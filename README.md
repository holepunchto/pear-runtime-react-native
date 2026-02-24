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

   Release builds load the OTA bundle from `pear-runtime/<productName>/app.bundle` when present (see **productName** below).

2. **Metro** and **App entry** below.

### Flow: Plain React Native

Apply the same native changes (iOS `bundleURL`, Android `getJSBundleFile`) to your `ios/` and `android/` projects manually so release builds load from `pear-runtime/<productName>/app.bundle` when present (see **productName** below). Then do **Metro** and **App entry** below.

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

### productName (required for OTA)

The OTA bundle path is `pear-runtime/<appName>/app.bundle`, where `appName` is taken from the **host app’s** `package.json` **`productName`** field. You must set it before running prebuild:

```json
{ "name": "my-app", "productName": "MyApp" }
```

- **Prebuild:** If `productName` is missing or empty, the Expo config plugin throws and prebuild fails.
- **Runtime:** If the app name is missing in the injected native code, the app throws at boot as a fallback.

## API

#### `const pear = PearRuntime()`

Create a pear runtime (currently doesnt do anything on its own).

#### `IPC <stream.Duplex> = pear.run(filename, bundle, argv)`

Start a Bare worklet. returns IPC duplex stream.

## License

Apache-2.0
