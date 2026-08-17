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
    return pearOtaSemVerNewer(version, native) ? bundle : fallback
#endif
  }

  private func pearOtaSemVerNewer(_ a: String, _ b: String) -> Bool {
    func numeric(_ value: Substring) -> Bool {
      return !value.isEmpty && value.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }
    }

    func valid(_ value: Substring) -> Bool {
      return !value.isEmpty && value.utf8.allSatisfy {
        ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) ||
          ($0 >= 97 && $0 <= 122) || $0 == 45
      }
    }

    func parse(_ input: String) -> (core: [Substring], prerelease: [Substring])? {
      let metadata = input.split(
        separator: "+",
        maxSplits: 1,
        omittingEmptySubsequences: false
      )

      if metadata.count == 2 {
        let build = metadata[1].split(separator: ".", omittingEmptySubsequences: false)
        guard build.allSatisfy(valid) else { return nil }
      }

      let release = metadata[0].split(
        separator: "-",
        maxSplits: 1,
        omittingEmptySubsequences: false
      )
      let core = release[0].split(separator: ".", omittingEmptySubsequences: false)
      guard core.count == 3,
        core.allSatisfy({ numeric($0) && ($0.count == 1 || $0.first != "0") })
      else { return nil }

      let prerelease = release.count == 2
        ? release[1].split(separator: ".", omittingEmptySubsequences: false)
        : []
      guard prerelease.allSatisfy({
        valid($0) && (!numeric($0) || $0.count == 1 || $0.first != "0")
      }) else { return nil }

      return (core, prerelease)
    }

    func compareNumeric(_ lhs: Substring, _ rhs: Substring) -> Int {
      if lhs.count != rhs.count { return lhs.count > rhs.count ? 1 : -1 }
      if lhs == rhs { return 0 }
      return lhs.lexicographicallyPrecedes(rhs) ? -1 : 1
    }

    guard let lhs = parse(a), let rhs = parse(b) else { return false }

    for i in 0..<3 {
      let order = compareNumeric(lhs.core[i], rhs.core[i])
      if order != 0 { return order > 0 }
    }

    if lhs.prerelease.isEmpty || rhs.prerelease.isEmpty {
      return lhs.prerelease.isEmpty && !rhs.prerelease.isEmpty
    }

    for i in 0..<min(lhs.prerelease.count, rhs.prerelease.count) {
      let x = lhs.prerelease[i]
      let y = rhs.prerelease[i]
      if x == y { continue }

      let xNumeric = numeric(x)
      let yNumeric = numeric(y)
      if xNumeric && yNumeric { return compareNumeric(x, y) > 0 }
      if xNumeric != yNumeric { return !xNumeric }
      return !x.lexicographicallyPrecedes(y)
    }

    return lhs.prerelease.count > rhs.prerelease.count
  }`
}

// Returns the OTA bundle only when its version is newer than the installed app,
// otherwise null so React Native keeps loading the bundle shipped in the apk.
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
    if (bundle.exists() && pearOtaSemVerNewer(version, native)) bundle.absolutePath else null
  } catch (e: Exception) {
    null
  }
}

private val pearSemVerPattern = Regex(
  """(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*))?(?:[+][0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*)?"""
)

private data class PearSemVer(val core: List<String>, val prerelease: List<String>)

private fun pearSemVer(value: String): PearSemVer? {
  val match = pearSemVerPattern.matchEntire(value) ?: return null
  val prerelease = match.groupValues[4].takeIf { it.isNotEmpty() }?.split('.') ?: emptyList()
  if (prerelease.any { part ->
    part.length > 1 && part[0] == '0' && part.all { it in '0'..'9' }
  }) return null
  return PearSemVer(match.groupValues.slice(1..3), prerelease)
}

private fun pearNumericCompare(a: String, b: String): Int {
  if (a.length != b.length) return a.length.compareTo(b.length)
  return a.compareTo(b)
}

private fun pearSemVerCompare(a: PearSemVer, b: PearSemVer): Int {
  for (i in 0..2) {
    val result = pearNumericCompare(a.core[i], b.core[i])
    if (result != 0) return result
  }

  if (a.prerelease.isEmpty()) return if (b.prerelease.isEmpty()) 0 else 1
  if (b.prerelease.isEmpty()) return -1

  for (i in 0 until minOf(a.prerelease.size, b.prerelease.size)) {
    val x = a.prerelease[i]
    val y = b.prerelease[i]
    if (x == y) continue

    val xNumeric = x.all { it in '0'..'9' }
    val yNumeric = y.all { it in '0'..'9' }
    val result = when {
      xNumeric && yNumeric -> pearNumericCompare(x, y)
      xNumeric -> -1
      yNumeric -> 1
      else -> x.compareTo(y)
    }
    if (result != 0) return result
  }

  return a.prerelease.size.compareTo(b.prerelease.size)
}

private fun pearOtaSemVerNewer(a: String, b: String): Boolean {
  val x = pearSemVer(a) ?: return false
  val y = pearSemVer(b) ?: return false
  return pearSemVerCompare(x, y) > 0
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
