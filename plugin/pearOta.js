'use strict'

const fs = require('fs/promises')
const path = require('path')
const t = require(path.join(__dirname, '../lib/ota-templates.js'))

const EXPO_BUNDLE_ROOT = '.expo/.virtual-metro-entry'
const ISSUES = 'https://github.com/holepunchto/pear-runtime-react-native/issues'

async function findAppDelegatePath(platformRoot, projectName) {
  const candidates = [
    path.join(platformRoot, projectName, 'AppDelegate.swift'),
    path.join(platformRoot, projectName, 'AppDelegate.mm'),
    path.join(platformRoot, projectName, 'AppDelegate.m')
  ]
  for (const p of candidates) {
    try {
      await fs.access(p)
      return p
    } catch {}
  }
  return null
}

async function findMainApplicationInDir(dir) {
  const entries = await fs.readdir(dir).catch(() => [])
  for (const name of entries) {
    const full = path.join(dir, name)
    if (name === 'MainApplication.kt' || name === 'MainApplication.java') return full
    const stat = await fs.stat(full).catch(() => null)
    if (stat?.isDirectory()) {
      const found = await findMainApplicationInDir(full)
      if (found) return found
    }
  }
  return null
}

function findMainApplicationPath(platformRoot) {
  const javaDir = path.join(platformRoot, 'app', 'src', 'main', 'java')
  return findMainApplicationInDir(javaDir)
}

function pearOta(config) {
  return require('expo/config-plugins').withPlugins(config, [
    withIosBundleUrl,
    withAndroidBundleFile
  ])
}

function withIosBundleUrl(config) {
  const { withDangerousMod } = require('expo/config-plugins')
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      if (config.modRequest.introspect) return config
      const platformRoot = config.modRequest.platformProjectRoot
      const projectName = config.modRequest.projectName || 'unknown'
      const appDelegatePath = await findAppDelegatePath(platformRoot, projectName)
      if (!appDelegatePath) {
        throw new Error(
          `pear-runtime-react-native: no AppDelegate found under ${path.join(platformRoot, projectName)}, ` +
            `so bundleURL() cannot be patched and release builds would silently ignore Pear updates. ` +
            `Please open an issue at ${ISSUES}`
        )
      }
      let contents = await fs.readFile(appDelegatePath, 'utf8')
      if (contents.includes(t.OTA_MARKER)) return config
      const isSwift = appDelegatePath.endsWith('.swift')
      const re = isSwift ? t.IOS_SWIFT_REGEX : t.IOS_OBJC_REGEX
      if (!re.test(contents)) {
        throw new Error(
          `pear-runtime-react-native: no bundleURL implementation found in ${appDelegatePath}, ` +
            `so release builds would silently ignore Pear updates. This React Native version is not ` +
            `supported yet -- please open an issue at ${ISSUES}`
        )
      }
      const newMethod = isSwift
        ? t.swiftBundleUrl(EXPO_BUNDLE_ROOT)
        : t.objCBundleUrl(EXPO_BUNDLE_ROOT)
      contents = contents.replace(re, t.OTA_MARKER + '\n' + newMethod)
      await fs.writeFile(appDelegatePath, contents)
      return config
    }
  ])
}

function withAndroidBundleFile(config) {
  const { withDangerousMod } = require('expo/config-plugins')
  return withDangerousMod(config, [
    'android',
    async (config) => {
      if (config.modRequest.introspect) return config
      const platformRoot = config.modRequest.platformProjectRoot
      const mainAppPath = await findMainApplicationPath(platformRoot)
      if (!mainAppPath) {
        throw new Error(
          `pear-runtime-react-native: no MainApplication found under ${platformRoot}, so the OTA ` +
            `bundle path cannot be wired up and release builds would silently ignore Pear updates. ` +
            `Please open an issue at ${ISSUES}`
        )
      }
      if (!mainAppPath.endsWith('.kt')) {
        throw new Error(
          `pear-runtime-react-native: ${mainAppPath} is Java; only a Kotlin MainApplication can be ` +
            `patched for OTA updates. Convert it to MainApplication.kt, or apply the Android changes ` +
            `by hand as described in the README.`
        )
      }
      const contents = await fs.readFile(mainAppPath, 'utf8')
      const patched = t.patchAndroidMainApplication(contents)
      if (patched !== null) await fs.writeFile(mainAppPath, patched)
      return config
    }
  ])
}

module.exports = pearOta
