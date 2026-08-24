const { test } = require('brittle')
const fixtures = require('./fixtures')
const { patchAppDelegate, patchMainApplication } = require('../lib/ota-templates')

const BUNDLE_ROOT = '.expo/.virtual-metro-entry'
const SDKS = ['53', '54', '55']

const appDelegate = (sdk) => fixtures[`sdk${sdk}-AppDelegate.swift`]
const mainApplication = (sdk) => fixtures[`sdk${sdk}-MainApplication.kt`]

const PLATFORMS = [
  {
    name: 'ios',
    patch: (contents) => patchAppDelegate(contents, BUNDLE_ROOT),
    stock: () => appDelegate('55')
  },
  {
    name: 'android',
    patch: (contents) => patchMainApplication(contents),
    stock: () => mainApplication('55')
  }
]

test('generates SemVer OTA boot control', (t) => {
  const swift = patchAppDelegate(appDelegate('55'), BUNDLE_ROOT)
  const kotlin = patchMainApplication(mainApplication('55'))

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
})

test('linked code is delimited so it can be recognised later', (t) => {
  for (const source of [
    patchAppDelegate(appDelegate('55'), BUNDLE_ROOT),
    patchMainApplication(mainApplication('55'))
  ]) {
    t.ok(/\/\/ !!![^\n]*!!!/.test(source), 'carries the edit comment')
    t.is(
      (source.match(/pear-runtime-react-native OTA v\d+ end/g) || []).length,
      1,
      'one end marker'
    )
  }
})

test('patches the stock AppDelegate of every supported SDK, once', (t) => {
  for (const sdk of SDKS) {
    const stock = appDelegate(sdk)
    const patched = patchAppDelegate(stock, BUNDLE_ROOT)

    t.not(patched, null, `sdk ${sdk} patched`)
    t.is(
      (patched.match(/private func pearOtaSemVerNewer/g) || []).length,
      1,
      `sdk ${sdk} one helper`
    )
    t.is((patched.match(/override func bundleURL/g) || []).length, 1, `sdk ${sdk} one bundleURL`)
    t.ok(patched.includes('class AppDelegate'), `sdk ${sdk} rest of the file kept`)
    t.is(patchAppDelegate(patched, BUNDLE_ROOT), null, `sdk ${sdk} idempotent`)
  }
})

test('android linking requires the SDK 55 react host', (t) => {
  const patched = patchMainApplication(mainApplication('55'))
  t.ok(patched.includes('jsBundleFilePath = pearOtaBundle(applicationContext)'))
  t.is(patchMainApplication(patched), null, 'idempotent')

  for (const sdk of ['53', '54']) {
    t.exception(
      () => patchMainApplication(mainApplication(sdk)),
      /no ExpoReactHostFactory\.getDefaultReactHost\(\)[\s\S]*SDK 55 and newer/,
      `sdk ${sdk} explains why it cannot link`
    )
  }
})

function withoutWarnings(fn) {
  const warnings = []
  const warn = console.warn
  console.warn = (message) => warnings.push(message)
  try {
    return { result: fn(), warnings }
  } finally {
    console.warn = warn
  }
}

test('the same version is never touched, edit comment or not', (t) => {
  for (const { name, patch, stock } of PLATFORMS) {
    const linked = patch(stock())

    t.is(patch(linked), null, name + ': untouched')
    t.is(patch(linked.replace(/[^\n]*!!![^\n]*\n/, '')), null, name + ': untouched once edited')
  }
})

test('another version is replaced while the edit comment is there', (t) => {
  for (const { name, patch, stock } of PLATFORMS) {
    const linked = patch(stock())

    for (const other of ['1', '99']) {
      const { result, warnings } = withoutWarnings(() =>
        patch(linked.replace(/OTA v\d+/g, 'OTA v' + other))
      )

      t.not(result, null, name + ': v' + other + ' replaced')
      t.absent(result.includes('OTA v' + other), name + ': old block gone')
      t.is((result.match(/\/\/ !!!/g) || []).length, 1, name + ': one edit comment')
      t.is((result.match(/OTA v\d+ end/g) || []).length, 1, name + ': one end marker')
      t.is(warnings.length, 0, name + ': nothing to warn about')
      t.is(patch(result), null, name + ': result is current')
    }
  }
})

test('another version is only reported once the edit comment is gone', (t) => {
  for (const { name, patch, stock } of PLATFORMS) {
    const edited = patch(stock())
      .replace(/OTA v\d+/g, 'OTA v1')
      .replace(/[^\n]*!!![^\n]*\n/, '')
    const { result, warnings } = withoutWarnings(() => patch(edited))

    t.is(result, null, name + ': left alone')
    t.is(warnings.length, 1, name + ': one warning')
    t.ok(/was edited[\s\S]*prebuild --clean/.test(warnings[0]), name + ': says what to do')
  }
})

test('a block with no end marker is reported, not linked over', (t) => {
  for (const { name, patch, stock } of PLATFORMS) {
    const legacy = patch(stock()).replace(/\n[^\n]*OTA v\d+ end/, '')
    const { result, warnings } = withoutWarnings(() => patch(legacy))

    t.is(result, null, name + ': left alone')
    t.is(warnings.length, 1, name + ': one warning')
  }
})

test('a target function holding none of our code is linked over', (t) => {
  const custom = appDelegate('55').replace(
    'return Bundle.main.url(forResource: "main", withExtension: "jsbundle")',
    'return myOwnUpdatesLibrary.bundleURL()'
  )
  const linked = patchAppDelegate(custom, BUNDLE_ROOT)

  t.not(linked, null, 'linked rather than refused')
  t.absent(linked.includes('myOwnUpdatesLibrary'), 'the custom implementation is gone')
})

test('kotlin argument injection survives a trailing comma', (t) => {
  const trailing = mainApplication('55').replace(
    /(\n\s*\}\n)(\s*\)\n\s*\})/,
    (_, block, close) => block.replace(/\}\n$/, '},\n') + close
  )
  const out = patchMainApplication(trailing)

  t.absent(/,\s*,/.test(out), 'no double comma')
  t.is((out.match(/jsBundleFilePath = pearOtaBundle/g) || []).length, 1)
})

test('kotlin argument injection lands after code, not inside a trailing comment', (t) => {
  const out = patchMainApplication(`class MainApplication {
  val reactHost = ExpoReactHostFactory.getDefaultReactHost(
    context = applicationContext,
    packageList = PackageList(this).packages
    // TODO add custom packages
  )
}`)

  t.ok(out.includes('packageList = PackageList(this).packages,'))
  t.absent(out.includes('// TODO add custom packages,'), 'comment kept intact')
  t.is((out.match(/jsBundleFilePath = pearOtaBundle/g) || []).length, 1)
})
