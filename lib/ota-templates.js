'use strict'

const OTA_MARKER = '// pear-runtime-react-native OTA bundleURL'
const OTA_MARKER_ANDROID = '// pear-runtime-react-native OTA bundle'
// Written by <= 2.0.1, which patched a different (and non-functional) shape.
const OTA_MARKER_ANDROID_LEGACY = '// pear-runtime-react-native OTA getJSBundleFile'

const IOS_SWIFT_REGEX = /override\s+func\s+bundleURL\s*\(\s*\)\s*->\s*URL\s*\?\s*\{[\s\S]*?\n\s*}/
const IOS_OBJC_REGEX = /-\s*\(NSURL\s*\*\s*\)\s*bundleURL\s*\{[\s\S]*?\n\s*}/

function swiftBundleUrl(bundleRoot) {
  return `override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "${bundleRoot}")
#else
    let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    let otaBundleURL = appSupport.appendingPathComponent("pear-runtime/ota/app.bundle")
    if FileManager.default.fileExists(atPath: otaBundleURL.path) {
      return otaBundleURL
    }
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }`
}

function objCBundleUrl(bundleRoot) {
  return `- (NSURL *)bundleURL {
#if DEBUG
  return [RCTBundleURLProvider sharedSettings].jsBundleURLForBundleRoot:@"${bundleRoot}"];
#else
  NSURL *appSupport = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *otaURL = [appSupport URLByAppendingPathComponent:@"pear-runtime/ota/app.bundle"];
  if ([NSFileManager.defaultManager fileExistsAtPath:otaURL.path]) {
    return otaURL;
  }
  return [NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}`
}

// Android. Three MainApplication shapes are supported, in priority order:
//
//   1. Expo + New Architecture (Expo SDK 52+, RN 0.76+), where MainApplication
//      exposes only `reactHost` built by ExpoReactHostFactory and there is no
//      ReactNativeHost to override anything on. The bundle path is an argument.
//   2. A MainApplication that already overrides getJSBundleFile().
//   3. The plain React Native template's DefaultReactNativeHost, recognised by
//      its getPackages() override, which gets a getJSBundleFile() added to it.
//
// All three call the same helper, injected into MainApplication itself.

const EXPO_REACT_HOST_CALL = 'ExpoReactHostFactory.getDefaultReactHost('
const EXPO_BUNDLE_FILE_ARGUMENT = 'jsBundleFilePath = pearOtaBundlePath()'

const ANDROID_GET_JS_BUNDLE_FILE_REGEX =
  /^([ \t]*)override\s+fun\s+getJSBundleFile\s*\(\s*\)\s*:\s*String\?\s*(?:=[^\n]*|\{[\s\S]*?^\1\})/m
const ANDROID_GET_PACKAGES_REGEX =
  /^([ \t]*)override\s+fun\s+getPackages\s*\(\s*\)\s*:\s*List\s*<\s*ReactPackage\s*>\s*=[\s\S]*?^\s*\}/m

const ANDROID_GET_JS_BUNDLE_FILE =
  'override fun getJSBundleFile(): String? = pearOtaBundlePath() ?: super.getJSBundleFile()'

function androidBundlePathFunction() {
  return `
  ${OTA_MARKER_ANDROID}
  //
  // Release builds always load the JS bundle from a fixed path under filesDir,
  // seeded from the APK's embedded bundle on first launch. pear-runtime-updater
  // swaps an applied update into that same directory, and the bundle is re-read
  // from disk every time the React instance is (re)created, so an update takes
  // effect on the next reload.
  //
  // The obvious alternative -- "use the OTA file if it exists, else fall back to
  // the embedded bundle" -- does not work on Android: unlike iOS's bundleURL(),
  // the path here is resolved once, when the ReactHost or ReactInstanceManager
  // is built, and the result is kept for the life of the process. A freshly
  // installed app resolves it before any update exists, so the first applied
  // update would never load and the app would keep offering it forever.
  private fun pearOtaBundlePath(): String? {
    if (BuildConfig.DEBUG) return null
    return try {
      val root = File(applicationContext.filesDir, "pear-runtime")
      val otaDir = File(root, "ota")
      val bundle = File(otaDir, "app.bundle")
      // Kept outside otaDir: applying an update replaces that whole directory.
      val stamp = File(root, "ota.apk-version")
      val installed = packageManager.getPackageInfo(packageName, 0).lastUpdateTime.toString()

      // A newly installed APK ships a newer embedded bundle than any payload
      // staged against the previous build, so drop the stale one.
      if (stamp.takeIf { it.exists() }?.readText() != installed) {
        otaDir.deleteRecursively()
      }

      if (!bundle.exists()) {
        otaDir.mkdirs()
        val staged = File(otaDir, "app.bundle.staged")
        assets.open("index.android.bundle").use { input ->
          staged.outputStream().use { output -> input.copyTo(output) }
        }
        if (!staged.renameTo(bundle)) {
          staged.delete()
          return null
        }
        stamp.writeText(installed)
      }

      bundle.absolutePath
    } catch (err: Exception) {
      // Never fail to boot over OTA plumbing: fall back to the embedded bundle.
      null
    }
  }
`
}

// Index of the ')' closing the call opened at `open`, skipping line comments so
// a commented-out `add(MyReactNativePackage())` cannot unbalance the count.
function findCallEnd(contents, open) {
  let depth = 0
  for (let i = open; i < contents.length; i++) {
    if (contents[i] === '/' && contents[i + 1] === '/') {
      i = contents.indexOf('\n', i)
      if (i === -1) break
      continue
    }
    if (contents[i] === '(') depth++
    else if (contents[i] === ')' && --depth === 0) return i
  }
  return -1
}

function addNamedArgument(contents, callee, argument) {
  const at = contents.indexOf(callee)
  const end = findCallEnd(contents, at + callee.length - 1)
  if (end === -1) throw new Error(`pear-runtime-react-native: unbalanced ${callee} call`)

  // Append after the last existing argument, leaving the closing paren put.
  let insertAt = end
  while (/\s/.test(contents[insertAt - 1])) insertAt--
  return contents.slice(0, insertAt) + `,\n      ${argument}` + contents.slice(insertAt)
}

function addFileImport(contents) {
  if (/^import\s+java\.io\.File\s*$/m.test(contents)) return contents
  return contents.replace(/^(package\s+[\w.]+[ \t]*\n)/m, '$1\nimport java.io.File\n')
}

function addBundlePathFunction(contents) {
  // The class body ends at the file's last brace.
  const at = contents.lastIndexOf('}')
  return contents.slice(0, at) + androidBundlePathFunction() + contents.slice(at)
}

// Returns the patched MainApplication.kt source, or null if it is already
// patched. Throws when none of the known shapes match rather than returning the
// source untouched: a silently unpatched MainApplication produces a release
// build that ignores OTA updates entirely, which only shows up in production.
function patchAndroidMainApplication(contents) {
  if (contents.includes(OTA_MARKER_ANDROID)) return null

  // Drop the marker left by <= 2.0.1 so its getJSBundleFile override, which the
  // rules below rewrite, does not keep a stale comment attached to it.
  let next = contents.replace(new RegExp(`^[ \t]*${OTA_MARKER_ANDROID_LEGACY}[ \t]*\n`, 'm'), '')

  if (next.includes(EXPO_REACT_HOST_CALL)) {
    next = addNamedArgument(next, EXPO_REACT_HOST_CALL, EXPO_BUNDLE_FILE_ARGUMENT)
  } else if (ANDROID_GET_JS_BUNDLE_FILE_REGEX.test(next)) {
    next = next.replace(
      ANDROID_GET_JS_BUNDLE_FILE_REGEX,
      (_, indent) => indent + ANDROID_GET_JS_BUNDLE_FILE
    )
  } else if (ANDROID_GET_PACKAGES_REGEX.test(next)) {
    next = next.replace(
      ANDROID_GET_PACKAGES_REGEX,
      (block, indent) => `${block}\n\n${indent}${ANDROID_GET_JS_BUNDLE_FILE}`
    )
  } else {
    throw new Error(
      'pear-runtime-react-native: MainApplication.kt has no ExpoReactHostFactory.getDefaultReactHost() ' +
        'call, getJSBundleFile() override or getPackages() override, so the OTA bundle path cannot be ' +
        'wired up and release builds would silently ignore Pear updates. This React Native / Expo ' +
        'version is not supported yet -- please open an issue at ' +
        'https://github.com/holepunchto/pear-runtime-react-native/issues'
    )
  }

  return addBundlePathFunction(addFileImport(next))
}

module.exports = {
  OTA_MARKER,
  OTA_MARKER_ANDROID,
  OTA_MARKER_ANDROID_LEGACY,
  IOS_SWIFT_REGEX,
  IOS_OBJC_REGEX,
  swiftBundleUrl,
  objCBundleUrl,
  patchAndroidMainApplication
}
