'use strict'

const MARKER = '// pear-runtime-react-native OTA v3'

const SWIFT_BUNDLE_URL = /override\s+func\s+bundleURL\s*\(\s*\)\s*->\s*URL\s*\?\s*\{/
const KOTLIN_REACT_HOST = /ExpoReactHostFactory\s*\.\s*getDefaultReactHost\s*\(/

function swiftBundleURL(bundleRoot) {
  return `${MARKER}
  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "${bundleRoot}")
#else
    let fallback = Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
      .first!.appendingPathComponent("pear-runtime/ota")
    let bundle = dir.appendingPathComponent("app.bundle")
    guard FileManager.default.fileExists(atPath: bundle.path),
      let data = try? Data(contentsOf: dir.appendingPathComponent("package.json")),
      let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let version = manifest["version"] as? String
    else { return fallback }
    let native =
      (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
    return pearOtaNewer(version, native) ? bundle : fallback
#endif
  }

  private func pearOtaNewer(_ a: String, _ b: String) -> Bool {
    func parts(_ v: String) -> [Int] {
      return v.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)[0]
        .split(separator: ".").map { Int($0) ?? 0 }
    }
    let x = parts(a)
    let y = parts(b)
    for i in 0..<3 {
      let l = i < x.count ? x[i] : 0
      let r = i < y.count ? y[i] : 0
      if l != r { return l > r }
    }
    return false
  }`
}

function kotlinHelpers() {
  return `${MARKER}
private fun pearOtaBundle(context: android.content.Context): String? {
  if (BuildConfig.DEBUG) return null
  return try {
    val dir = java.io.File(context.filesDir, "pear-runtime/ota")
    val bundle = java.io.File(dir, "app.bundle")
    val manifest = java.io.File(dir, "package.json")
    val native = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0.0.0"
    val version = if (manifest.exists()) org.json.JSONObject(manifest.readText()).optString("version") else ""
    if (!(bundle.exists() && pearOtaNewer(version, native)) && (version != native || !bundle.exists())) {
      dir.mkdirs()
      context.assets.open("index.android.bundle").use { input ->
        bundle.outputStream().use { output -> input.copyTo(output) }
      }
      manifest.writeText("{\\"version\\":\\"" + native + "\\"}")
    }
    bundle.absolutePath
  } catch (e: Exception) {
    null
  }
}

private fun pearOtaNewer(a: String, b: String): Boolean {
  fun parts(v: String) = v.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
  val x = parts(a)
  val y = parts(b)
  for (i in 0 until 3) {
    val l = x.getOrElse(i) { 0 }
    val r = y.getOrElse(i) { 0 }
    if (l != r) return l > r
  }
  return false
}`
}

function findEnd(contents, from, open, close) {
  const start = contents.indexOf(open, from)
  if (start === -1) return -1
  let depth = 0
  for (let i = start; i < contents.length; i++) {
    if (contents[i] === open) depth++
    else if (contents[i] === close && --depth === 0) return i
  }
  return -1
}

function replaceFunction(contents, head, replacement) {
  const start = contents.search(head)
  if (start === -1) return null
  const end = findEnd(contents, start, '{', '}')
  if (end === -1) return null
  return contents.slice(0, start) + replacement.trimStart() + contents.slice(end + 1)
}

function patchAppDelegate(contents, bundleRoot, file = 'AppDelegate.swift') {
  if (contents.includes(MARKER)) return null
  const updated = replaceFunction(contents, SWIFT_BUNDLE_URL, swiftBundleURL(bundleRoot))
  if (updated === null) {
    throw new Error(`[pear-runtime-react-native] cannot patch ${file}: no bundleURL() found`)
  }
  return updated
}

function patchMainApplication(contents, file = 'MainApplication.kt') {
  if (contents.includes(MARKER)) return null
  const updated = injectBundlePathArg(contents)
  if (updated === null) {
    throw new Error(
      `[pear-runtime-react-native] cannot patch ${file}: no patchable ExpoReactHostFactory.getDefaultReactHost() found`
    )
  }
  return updated.replace(/\s+$/, '') + '\n\n' + kotlinHelpers() + '\n'
}

function injectBundlePathArg(contents) {
  const match = contents.match(KOTLIN_REACT_HOST)
  if (!match) return null
  const open = match.index + match[0].length - 1
  const close = findEnd(contents, open, '(', ')')
  if (close === -1) return null
  const args = contents.slice(open + 1, close)
  if (args.includes('jsBundleFilePath')) return null
  const indent = (args.match(/\n(\s*)$/) || [, ''])[1]
  return (
    contents.slice(0, open + 1) +
    args.replace(/\s+$/, '') +
    ',\n' +
    indent +
    '  jsBundleFilePath = pearOtaBundle(applicationContext)\n' +
    indent +
    contents.slice(close)
  )
}

module.exports = { patchAppDelegate, patchMainApplication }
