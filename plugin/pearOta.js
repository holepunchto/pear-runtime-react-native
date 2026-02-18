'use strict'

const fs = require('fs/promises')
const path = require('path')
const t = require(path.join(__dirname, '../lib/ota-templates.js'))

const EXPO_BUNDLE_ROOT = '.expo/.virtual-metro-entry'

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

async function findMainApplicationPath(platformRoot) {
  const javaDir = path.join(platformRoot, 'app', 'src', 'main', 'java')
  try {
    return await findMainApplicationInDir(javaDir)
  } catch {
    return null
  }
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
      if (!appDelegatePath) return config
      let contents = await fs.readFile(appDelegatePath, 'utf8')
      if (contents.includes(t.OTA_MARKER)) return config
      const isSwift = appDelegatePath.endsWith('.swift')
      const re = isSwift ? t.IOS_SWIFT_REGEX : t.IOS_OBJC_REGEX
      if (!re.test(contents)) return config
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
      if (!mainAppPath) return config
      let contents = await fs.readFile(mainAppPath, 'utf8')
      if (contents.includes(t.OTA_MARKER_ANDROID)) return config
      if (!contents.includes('import java.io.File')) {
        contents = contents.replace(/(package\s+[\w.]+\s*)/m, '$1\nimport java.io.File\n')
      }
      const hasGetJSBundle = /override\s+fun\s+getJSBundleFile\s*\(/.test(contents)
      if (hasGetJSBundle) {
        contents = contents.replace(
          /(override\s+fun\s+getJSBundleFile\s*\(\s*\)\s*:\s*String\?\s*\{)[\s\S]*?(\n\s*\})/m,
          (_, open, close) =>
            `${t.OTA_MARKER_ANDROID}\n${open}\n${t.ANDROID_GETJSBUNDLE_BODY}${close}`
        )
      } else {
        const m = contents.match(
          /(override\s+fun\s+getPackages\s*\(\s*\)\s*:\s*List\s*<\s*ReactPackage\s*>\s*=[\s\S]*?^\s*\})/m
        )
        if (!m) return config
        contents = contents.replace(m[0], m[0] + t.androidOverridesBlock(EXPO_BUNDLE_ROOT))
      }
      await fs.writeFile(mainAppPath, contents)
      return config
    }
  ])
}

module.exports = pearOta
