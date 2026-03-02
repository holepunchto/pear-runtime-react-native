'use strict'

const OTA_MARKER = '// pear-runtime-react-native OTA bundleURL'
const OTA_MARKER_ANDROID = '// pear-runtime-react-native OTA getJSBundleFile'

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

const ANDROID_GETJSBUNDLE_BODY = `      if (BuildConfig.DEBUG) return super.getJSBundleFile()
      val file = File(applicationContext.filesDir, "pear-runtime/ota/app.bundle")
      return if (file.exists()) file.absolutePath else super.getJSBundleFile()`

function androidOverridesBlock() {
  return `
    ${OTA_MARKER_ANDROID}
    override fun getJSBundleFile(): String? {
      if (BuildConfig.DEBUG) return super.getJSBundleFile()
      val file = File(applicationContext.filesDir, "pear-runtime/ota/app.bundle")
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
  ANDROID_GETJSBUNDLE_BODY,
  androidOverridesBlock
}
