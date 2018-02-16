function streamOnAsync(stream, eventName) {
  return new Promise((resolve, reject) => {
    stream.on(eventName, (...args) => {
      resolve(...args)
    })
    stream.on('error', e => {
      reject(e)
    })
  })
}

function delayAsync(timeout) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, timeout)
  })
}

function orderedAsync(promises) {
  let orderedDefered = []
  let orderedPromises = []
  for (let promise of promises) {
    orderedPromises.push(
      new Promise((resolve, reject) => {
        orderedDefered.push({ resolve, reject })
      })
    )
    promise
      .then((...args) => {
        orderedDefered.shift().resolve(...args)
      })
      .catch((...args) => {
        orderedDefered.shift().reject(...args)
      })
  }
  return orderedPromises
}

module.exports = {
  streamOnAsync,
  delayAsync,
  orderedAsync
}
