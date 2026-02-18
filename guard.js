'use strict'

const RNFS = require('react-native-fs')
const { Platform } = require('react-native')

const BUNDLE_PATH =
  RNFS.DocumentDirectoryPath + '/pear-runtime/upgrade/runtime.' + Platform.OS + '.bundle'

async function earlyBootGuard() {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default
  const DevSettings = require('react-native').DevSettings
  const pending = await AsyncStorage.getItem('updatePending')
  const confirmed = await AsyncStorage.getItem('updateConfirmed')

  if (pending === 'true' && confirmed !== 'true') {
    if (await RNFS.exists(BUNDLE_PATH)) {
      await RNFS.unlink(BUNDLE_PATH)
    }
    await AsyncStorage.multiRemove(['updatePending', 'updateConfirmed'])
    if (DevSettings && typeof DevSettings.reload === 'function') {
      DevSettings.reload()
    }
    return false
  }
  return true
}

async function confirmUpdate() {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default
  const pending = await AsyncStorage.getItem('updatePending')
  if (pending === 'true') {
    await AsyncStorage.multiSet([
      ['updateConfirmed', 'true'],
      ['updatePending', 'false']
    ])
  }
}

function bootstrap(App, registerRootComponent) {
  earlyBootGuard().then((ok) => {
    if (!ok) return
    if (typeof registerRootComponent === 'function') {
      registerRootComponent(App)
    } else {
      try {
        require('expo').registerRootComponent(App)
      } catch (_) {
        const { AppRegistry } = require('react-native')
        AppRegistry.registerComponent('Main', () => App)
      }
    }
  })
}

module.exports = { earlyBootGuard, confirmUpdate, bootstrap }
