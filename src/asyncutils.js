/* istanbul ignore next */
function promiseOn(stream, eventName) {
  return new Promise((resolve, reject) => {
    stream.on(eventName, (...args) => {
      resolve(...args)
    })
    stream.on('error', e => {
      reject(e)
    })
  })
}

module.exports = {
  promiseOn
}
