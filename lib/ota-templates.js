'use strict'

const OTA_MARKER = '// pear-runtime-react-native OTA bundleURL'
const OTA_MARKER_ANDROID = '// pear-runtime-react-native OTA getJSBundleFile'

const IOS_SWIFT_REGEX = /override\s+func\s+bundleURL\s*\(\s*\)\s*->\s*URL\s*\?\s*\{[\s\S]*?\n\s*}/
const IOS_OBJC_REGEX = /-\s*\(NSURL\s*\*\s*\)\s*bundleURL\s*\{[\s\S]*?\n\s*}/

// Escape appName for use inside Swift/ObjC/Kotlin string literals
function escapeForNative(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function swiftBundleUrl(bundleRoot, appName) {
  const escaped = escapeForNative(appName)
  return `override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "${bundleRoot}")
#else
    let otaAppName = "${escaped}"
    if otaAppName.isEmpty {
      fatalError("pear-runtime-react-native: productName is required in package.json")
    }
    let documentDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let otaBundleURL = documentDirectory.appendingPathComponent("pear-runtime/\\(otaAppName)/app.bundle")
    if FileManager.default.fileExists(atPath: otaBundleURL.path) {
      return otaBundleURL
    }
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }`
}

function objCBundleUrl(bundleRoot, appName) {
  const escaped = escapeForNative(appName)
  return `- (NSURL *)bundleURL {
#if DEBUG
  return [RCTBundleURLProvider sharedSettings].jsBundleURLForBundleRoot:@"${bundleRoot}"];
#else
  NSString *otaAppName = @"${escaped}";
  if (otaAppName.length == 0) {
    [NSException raise:@"PearRuntimeOTA" format:@"pear-runtime-react-native: productName is required in package.json"];
  }
  NSURL *docDir = [NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *otaURL = [docDir URLByAppendingPathComponent:[NSString stringWithFormat:@"pear-runtime/%@/app.bundle", otaAppName]];
  if ([NSFileManager.defaultManager fileExistsAtPath:otaURL.path]) {
    return otaURL;
  }
  return [NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}`
}

function androidGetJsBundleBody(appName) {
  const escaped = escapeForNative(appName)
  return `      if (BuildConfig.DEBUG) return super.getJSBundleFile()
      val otaAppName = "${escaped}"
      if (otaAppName.isEmpty()) throw RuntimeException("pear-runtime-react-native: productName is required in package.json")
      val file = File(applicationContext.filesDir, "pear-runtime/$otaAppName/app.bundle")
      return if (file.exists()) file.absolutePath else super.getJSBundleFile()`
}

function androidOverridesBlock(appName) {
  const escaped = escapeForNative(appName)
  return `
    ${OTA_MARKER_ANDROID}
    override fun getJSBundleFile(): String? {
      if (BuildConfig.DEBUG) return super.getJSBundleFile()
      val otaAppName = "${escaped}"
      if (otaAppName.isEmpty()) throw RuntimeException("pear-runtime-react-native: productName is required in package.json")
      val file = File(applicationContext.filesDir, "pear-runtime/$otaAppName/app.bundle")
      return if (file.exists()) file.absolutePath else super.getJSBundleFile()
    }
`
}

module.exports = {
  OTA_MARKER,
  OTA_MARKER_ANDROID,
  IOS_SWIFT_REGEX,
  IOS_OBJC_REGEX,
  swiftBundleUrl,
  objCBundleUrl,
  androidGetJsBundleBody,
  androidOverridesBlock
}
