'use strict'

function getMetroConfig(projectRoot, options = {}) {
  const { useExpo = true, useSentry = false } = options
  const { getDefaultConfig: getRNConfig, mergeConfig } = require('@react-native/metro-config')

  let config = getRNConfig(projectRoot)

  if (useExpo) {
    const expo = load('expo/metro-config', options.useExpo === true)
    if (expo !== null) config = mergeConfig(config, expo.getDefaultConfig(projectRoot))
  }

  if (useSentry) {
    const sentry = load('@sentry/react-native/metro', true)
    if (sentry !== null) config = mergeConfig(config, sentry.getSentryExpoConfig(projectRoot))
  }

  return config
}

function load(specifier, required) {
  try {
    return require(specifier)
  } catch (err) {
    if (required || !isMissing(err, specifier)) throw err
    return null
  }
}

function isMissing(err, specifier) {
  if (err.code !== 'MODULE_NOT_FOUND' && err.code !== 'ERR_MODULE_NOT_FOUND') return false
  return err.message.includes(specifier)
}

module.exports = { getMetroConfig }
