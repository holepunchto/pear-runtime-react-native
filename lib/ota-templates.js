'use strict'

const VERSION = 3
const EDIT = '// !!! REMOVE THIS AND ONLY THIS COMMENT IF YOU EDIT !!!'
const TAG = `pear-runtime-react-native OTA v${VERSION}`
const END = `// ${TAG} end`
const BUNDLE_PATH_ARG = 'jsBundleFilePath = pearOtaBundle(applicationContext)'

// The edit comment is optional so a block keeps being recognised once it is removed, which is how a
// project says the code is now its own
const BLOCK =
  /(\/\/ !!![^\n]*\n\s*)?\/\/[^\n]*pear-runtime-react-native OTA v(\d+)[\s\S]*?pear-runtime-react-native OTA v\d+ end/

const SWIFT_BUNDLE_URL = /override\s+func\s+bundleURL\s*\(\s*\)\s*->\s*URL\s*\?\s*\{/
const KOTLIN_REACT_HOST = /ExpoReactHostFactory\s*\.\s*getDefaultReactHost\s*\(/

function swiftBundleURL(bundleRoot) {
  return `${EDIT}
  // ${TAG}
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
  }

  ${END}`
}

// Returns the OTA bundle only when its version is newer than the installed app,
// otherwise null so React Native keeps loading the bundle shipped in the apk.
function kotlinHelpers() {
  return `${EDIT}
// ${TAG}
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
}

${END}`
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
  const generated = swiftBundleURL(bundleRoot)
  const relinked = relink(contents, generated.trim(), file)
  if (relinked !== null) return relinked === contents ? null : relinked

  const updated = replaceFunction(contents, SWIFT_BUNDLE_URL, generated)
  if (updated === null) {
    throw new Error(`[pear-runtime-react-native] cannot patch ${file}: no bundleURL() found`)
  }
  return updated
}

function patchMainApplication(contents, file = 'MainApplication.kt') {
  const generated = kotlinHelpers().trim()
  const relinked = relink(contents, generated, file)
  if (relinked !== null) return relinked === contents ? null : relinked
  const updated = injectBundlePathArg(contents)
  if (updated === null) {
    throw new Error(
      `[pear-runtime-react-native] no ExpoReactHostFactory.getDefaultReactHost() in ${file}, which Expo SDK 55 and newer generate`
    )
  }

  return updated.replace(/\s+$/, '') + '\n\n' + kotlinHelpers() + '\n'
}

function relink(contents, generated, file) {
  const linked = contents.match(BLOCK)
  if (linked === null) {
    if (!contents.includes('pear-runtime-react-native OTA v')) return null
    warn(file, 'was linked by a release this one cannot replace')
    return contents
  }
  if (Number(linked[2]) === VERSION) return contents
  if (linked[1] === undefined) {
    warn(file, 'has OTA code that was edited')
    return contents
  }
  return (
    contents.slice(0, linked.index) + generated + contents.slice(linked.index + linked[0].length)
  )
}

function warn(file, what) {
  console.warn(
    `[pear-runtime-react-native] ${file} ${what}, so v${VERSION} was not linked. Run \`npx expo prebuild --clean\` to take it.`
  )
}

function injectBundlePathArg(contents) {
  const match = contents.match(KOTLIN_REACT_HOST)
  if (!match) return null
  const open = match.index + match[0].length - 1
  const close = findEnd(contents, open, '(', ')')
  if (close === -1) return null

  const lines = contents.slice(open + 1, close).split('\n')
  let last = lines.length - 1
  while (last > 0 && /^\s*(\/\/.*)?$/.test(lines[last])) last--
  lines[last] = lines[last].replace(/\s*,?\s*$/, '') + ','
  lines.splice(last + 1, 0, lines[last].match(/^\s*/)[0] + BUNDLE_PATH_ARG)

  return contents.slice(0, open + 1) + lines.join('\n') + contents.slice(close)
}

module.exports = { patchAppDelegate, patchMainApplication }
