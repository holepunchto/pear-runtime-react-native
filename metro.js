'use strict'

function getMetroConfig(projectRoot, options = {}) {
  const { useExpo = true, useSentry = false } = options
  const { getDefaultConfig: getRNConfig, mergeConfig } = require('@react-native/metro-config')

  let config = getRNConfig(projectRoot)

  if (useExpo) {
    try {
      const { getDefaultConfig: getExpoConfig } = require('expo/metro-config')
      config = mergeConfig(config, getExpoConfig(projectRoot))
    } catch (_) {}
  }

  if (useSentry) {
    try {
      const { getSentryExpoConfig } = require('@sentry/react-native/metro')
      config = mergeConfig(config, getSentryExpoConfig(projectRoot))
    } catch (_) {}
  }

  return config
}

module.exports = { getMetroConfig }
