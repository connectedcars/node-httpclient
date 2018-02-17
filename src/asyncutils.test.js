const expect = require('unexpected')
const { shuffleArray } = require('./testutils')

const AsyncUtils = require('./asyncutils')

describe('AsyncUtils', () => {
  it('orderedAsync', function() {
    this.slow(1000)
    let promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(AsyncUtils.delayAsync(20 * i).then(() => i))
    }
    shuffleArray(promises)
    //let result = []
    /* for (let promise of AsyncUtils.orderedAsync(promises)) {
      let value = await promise
      result.push(value)
    }*/
    let result = Promise.all(AsyncUtils.orderedAsync(promises))
    return expect(result, 'to be fulfilled with value satisfying', [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9
    ])
  })
})
