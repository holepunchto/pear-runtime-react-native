const { Worklet } = require('react-native-bare-kit')

module.exports = class PearRuntime {
  run(filename, bundle, argv) {
    const worklet = new Worklet()
    worklet.start(filename, bundle, argv)
    return worklet.IPC
  }
}
