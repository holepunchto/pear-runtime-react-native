# pear-runtime-react-native

Pear runtime for React Native: storage path, bare workers (worklets), and OTA updates.

```sh
npm install pear-runtime-react-native react-native-bare-kit
```

Requires `react-native-bare-kit` in your project.

---

## Usage

```js
import PearRuntime from 'pear-runtime-react-native'
import bundle from './worker.bundle.js'

const runtime = new PearRuntime()
const IPC = runtime.run('/worker.bundle', bundle, [runtime.dir])
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

   Release builds load the OTA bundle from `pear-runtime/upgrade/app.bundle` when present.

2. **Metro** and **App entry** below.

### Flow: Plain React Native

Apply the same native changes (iOS `bundleURL`, Android `getJSBundleFile`) to your `ios/` and `android/` projects manually so release builds load from `pear-runtime/upgrade/app.bundle` when present. Then do **Metro** and **App entry** below.

### Metro

Create `metro.config.js` in the project root:

```js
const { getMetroConfig } = require('pear-runtime-react-native/metro-config')
module.exports = getMetroConfig(__dirname)
```

Add `@react-native/metro-config` to your devDependencies. With Expo, `expo/metro-config` is merged in automatically. Then `npx react-native bundle` works for OTA payloads.

```sh
npm install @react-native/metro-config --save-dev
```

### Create OTA bundle (payload)

From the project root (entry file must match your app, e.g. `index.js`):

```sh
npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output dist/app.bundle --assets-dest dist/assets
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output dist/app.bundle --assets-dest dist/assets
cp -f package.json dist/package.json
```

Then stage and seed with `pear` as in your OTA flow.

---

## API

- **`new PearRuntime()`** — Create runtime. `runtime.dir` is the app storage path.
- **`runtime.on(event, callback)`** / **`off`** / **`once`** — Event shim.
- **`runtime.run(filename, bundle, argv)`** — Start worklet; returns IPC duplex.
- **`runtime.ready()`** / **`runtime.close()`** — Promise; no-op in react-native (API compatibility).
- **`runtime.applyUpdate()`** — Promise; no-op in react-native (API compatibility).

---

## License

Apache-2.0
