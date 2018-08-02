const { isPromise } = require('./asyncutils')

/**
 * @template T
 */
class AsyncArray extends Array {
  /** @param items {Array<Promise<T>>} */
  constructor(...items) {
    for (let item of items) {
      if (isPromise(item)) {
        item.catch(e => e)
      }
    }
    super(...items)
  }

  [Symbol.asyncIterator]() {
    let arrayIterator = this[Symbol.iterator]()
    return {
      next: () => {
        let next = arrayIterator.next()
        if (next.done) {
          return Promise.resolve({ done: true })
        }
        if (isPromise(next.value)) {
          return next.value.then(res => {
            return {
              done: false,
              value: res
            }
          })
        }
        return Promise.resolve({ done: false, value: next.value })
      }
    }
  }
}

module.exports = AsyncArray
