const { test } = require('brittle')
const { patchAndroidMainApplication, OTA_MARKER_ANDROID } = require('../lib/ota-templates.js')

// Expo SDK 52+ with the New Architecture: no ReactNativeHost at all, the bundle
// path is an argument to ExpoReactHostFactory.getDefaultReactHost().
const EXPO_NEW_ARCH = `package com.example.app

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
`

// The plain React Native template: DefaultReactNativeHost, recognised by its
// getPackages() override.
const RN_TEMPLATE = `package com.example.app

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactNativeHost

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // add(MyReactNativePackage())
            }

        override fun getJSMainModuleName(): String = "index"
      }
}
`

// A project that already overrides getJSBundleFile(), including one patched by
// pear-runtime-react-native <= 2.0.1.
const EXISTING_OVERRIDE = `package com.example.app

import android.app.Application
import com.facebook.react.ReactApplication
import com.facebook.react.defaults.DefaultReactNativeHost

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        // pear-runtime-react-native OTA getJSBundleFile
        override fun getJSBundleFile(): String? {
          if (BuildConfig.DEBUG) return super.getJSBundleFile()
          val file = File(applicationContext.filesDir, "pear-runtime/ota/app.bundle")
          return if (file.exists()) file.absolutePath else super.getJSBundleFile()
        }
      }
}
`

test('expo new architecture: bundle path passed to ExpoReactHostFactory', (t) => {
  const out = patchAndroidMainApplication(EXPO_NEW_ARCH)

  t.ok(out.includes('jsBundleFilePath = pearOtaBundlePath()'), 'passes the bundle path')
  t.ok(out.includes('private fun pearOtaBundlePath(): String?'), 'declares the helper')
  t.ok(out.includes('import java.io.File'), 'imports File')
  t.ok(out.includes(OTA_MARKER_ANDROID), 'leaves a marker')
  t.ok(
    out.includes('        },\n      jsBundleFilePath = pearOtaBundlePath()\n    )'),
    'appends after the last argument, keeping the call closed'
  )
  t.is(balance(out), 0, 'braces stay balanced')
  t.is(
    out.indexOf('private fun pearOtaBundlePath') >
      out.indexOf('override fun onConfigurationChanged'),
    true,
    'helper lands inside the class body'
  )
})

test('react native template: getJSBundleFile added to the host', (t) => {
  const out = patchAndroidMainApplication(RN_TEMPLATE)

  t.ok(
    out.includes(
      '        override fun getJSBundleFile(): String? = pearOtaBundlePath() ?: super.getJSBundleFile()'
    ),
    'adds the override at the getPackages indent'
  )
  t.ok(out.includes('private fun pearOtaBundlePath(): String?'), 'declares the helper')
  t.ok(out.includes('override fun getJSMainModuleName()'), 'leaves the rest of the host alone')
  t.is(balance(out), 0, 'braces stay balanced')
})

test('existing getJSBundleFile override is replaced, legacy marker dropped', (t) => {
  const out = patchAndroidMainApplication(EXISTING_OVERRIDE)

  t.ok(
    out.includes(
      '        override fun getJSBundleFile(): String? = pearOtaBundlePath() ?: super.getJSBundleFile()'
    ),
    'rewrites the override'
  )
  t.absent(out.includes('if (file.exists())'), 'drops the old exists-check body')
  t.absent(out.includes('OTA getJSBundleFile'), 'drops the marker written by <= 2.0.1')
  t.is(count(out, 'override fun getJSBundleFile'), 1, 'does not duplicate the override')
  t.is(balance(out), 0, 'braces stay balanced')
})

test('patching is idempotent', (t) => {
  for (const source of [EXPO_NEW_ARCH, RN_TEMPLATE, EXISTING_OVERRIDE]) {
    const once = patchAndroidMainApplication(source)
    t.is(patchAndroidMainApplication(once), null, 'second pass reports nothing to do')
  }
})

test('unrecognised MainApplication throws instead of silently doing nothing', (t) => {
  const unknown = `package com.example.app

import android.app.Application

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
  }
}
`
  t.exception(
    () => patchAndroidMainApplication(unknown),
    /cannot be wired up/,
    'refuses to produce a release build without OTA'
  )
})

function count(source, needle) {
  return source.split(needle).length - 1
}

function balance(source) {
  let depth = 0
  for (const c of source) {
    if (c === '{') depth++
    else if (c === '}') depth--
  }
  return depth
}
