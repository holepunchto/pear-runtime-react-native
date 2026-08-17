const { test } = require('brittle')
const { patchAppDelegate, patchMainApplication } = require('../lib/ota-templates')

test('generates SemVer OTA boot control', (t) => {
  const swift = patchAppDelegate(
    `class AppDelegate {
  override func bundleURL() -> URL? {
    return nil
  }
}`,
    '.expo/.virtual-metro-entry'
  )
  const kotlin = patchMainApplication(`class MainApplication {
  val reactHost = ExpoReactHostFactory.getDefaultReactHost(
    context = applicationContext,
    packageList = PackageList(this).packages
  )
}`)

  t.ok(swift.includes('// pear-runtime-react-native OTA v3'))
  t.ok(swift.includes('pearOtaSemVerNewer(version, native)'))
  t.ok(swift.includes('omittingEmptySubsequences: false'))
  t.ok(kotlin.includes('// pear-runtime-react-native OTA v3'))
  t.ok(kotlin.includes('pearOtaSemVerNewer(version, native)'))
  t.ok(kotlin.includes('pearSemVerPattern.matchEntire(value)'))
  t.ok(
    kotlin.includes(
      'if (bundle.exists() && pearOtaSemVerNewer(version, native)) bundle.absolutePath else null'
    )
  )
  t.ok(kotlin.includes('jsBundleFilePath = pearOtaBundle(applicationContext)'))
  t.is(patchAppDelegate(swift, '.expo/.virtual-metro-entry'), null)
  t.is(patchMainApplication(kotlin), null)
})
