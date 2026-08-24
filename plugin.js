'use strict'

const t = require('./lib/ota-templates.js')

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

  return withMainApplication(config, (config) => patch(config, t.patchMainApplication))
}

module.exports = pearOta
