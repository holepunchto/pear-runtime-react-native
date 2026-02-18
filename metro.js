'use strict'

function getMetroConfig(projectRoot) {
  const { getDefaultConfig: getRNConfig, mergeConfig } = require('@react-native/metro-config')
  const rnConfig = getRNConfig(projectRoot)
  try {
    const { getDefaultConfig: getExpoConfig } = require('expo/metro-config')
    const expoConfig = getExpoConfig(projectRoot)
    return mergeConfig(rnConfig, expoConfig)
  } catch (_) {
    return rnConfig
  }
}

module.exports = { getMetroConfig }
