'use strict'

const fs = require('fs/promises')
const path = require('path')
const t = require(path.join(__dirname, '../lib/ota-templates.js'))

const BUNDLE_ROOT = '.expo/.virtual-metro-entry'

async function find(dir, name) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.name === name) return full
    if (entry.isDirectory()) {
      const found = await find(full, name)
      if (found) return found
    }
  }
  return null
}

async function patch(file, transform) {
  const contents = await fs.readFile(file, 'utf8')
  const updated = transform(contents, path.basename(file))
  if (updated !== null) await fs.writeFile(file, updated)
}

function pearOta(config) {
  const { withDangerousMod, withPlugins } = require('expo/config-plugins')

  const ios = (config) =>
    withDangerousMod(config, [
      'ios',
      async (config) => {
        if (config.modRequest.introspect) return config
        const root = config.modRequest.platformProjectRoot
        const file = await find(root, 'AppDelegate.swift')
        if (!file) throw new Error(`[pear-runtime-react-native] no AppDelegate.swift under ${root}`)
        await patch(file, (contents, name) => t.patchAppDelegate(contents, BUNDLE_ROOT, name))
        return config
      }
    ])

  const android = (config) =>
    withDangerousMod(config, [
      'android',
      async (config) => {
        if (config.modRequest.introspect) return config
        const root = config.modRequest.platformProjectRoot
        const file = await find(root, 'MainApplication.kt')
        if (!file) throw new Error(`[pear-runtime-react-native] no MainApplication.kt under ${root}`)
        await patch(file, t.patchMainApplication)
        return config
      }
    ])

  return withPlugins(config, [ios, android])
}

module.exports = pearOta
