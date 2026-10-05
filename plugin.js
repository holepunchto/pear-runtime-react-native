'use strict'

const t = require('./lib/ota-templates.js')
const fs = require('fs/promises')
const path = require('path')

const BUNDLE_ROOT = '.expo/.virtual-metro-entry'

function patch(config, transform) {
  const file = config.modResults
  const contents = transform(file.contents, file.path)
  if (contents !== null) file.contents = contents
  return config
}

function pearOta(config) {
  const { withAppDelegate, withMainApplication } = require('expo/config-plugins')

  config = withAppDelegate(config, (config) =>
    patch(config, (contents, file) => t.patchAppDelegate(contents, BUNDLE_ROOT, file))
  )

  return withMainApplication(config, async (config) => {
    patch(config, t.patchMainApplication)
    const root = config.modRequest.projectRoot
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
    const options = pkg.expo?.autolinking
    const nativeDir = options?.android?.nativeModulesDir ?? options?.nativeModulesDir
    const dir = path.resolve(
      root,
      typeof nativeDir === 'string' ? nativeDir : 'modules',
      'pear-runtime-reload'
    )
    for (const [file, contents] of Object.entries(t.androidReloadModule())) {
      const destination = path.join(dir, file)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, contents)
    }
    return config
  })
}

module.exports = pearOta
