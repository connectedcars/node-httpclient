const AsyncArray = require('./asyncarray')
const expect = require('unexpected')

describe('AsyncArray', () => {
  it('should iterate of array of promises with error', async () => {
    let array = new AsyncArray(
      Promise.resolve(1),
      Promise.resolve(2),
      new Promise(resolve =>
        setTimeout(() => {
          resolve(3)
        }, 1)
      ),
      Promise.reject(new Error('4'))
    )

    await new Promise(resolve =>
      setTimeout(() => {
        resolve(3)
      }, 100)
    )

    let error = null
    try {
      for await (const item of array) {
      }
    } catch (e) {
      error = e
    }
    expect(error, 'not to be null')
  })
})
