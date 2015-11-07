import { checkInternals } from './internals'
import { installExternals } from './externals'
import handleError from '../lib/handleError'
import log from '../lib/log'

export default function scanFile(file, source) {
  log('scanFile', file)
  try {
    // install new stuff
    checkInternals(file, source)
    installExternals(file, source)
  }
  catch (e) {
    handleError(e)
  }
}
