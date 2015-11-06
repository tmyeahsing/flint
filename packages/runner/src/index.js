import bridge from './bridge'
import compiler from './compiler'
import handleError from './lib/handleError'
import server from './server'
import npm from './npm'
import opts from './opts'
import log from './lib/log'
import { initConfig } from './lib/config'
import gulp from './gulp'
import cache from './cache'
import openInBrowser from './lib/openInBrowser'
import watchingMessage from './lib/watchingMessage'
import clear from './fbuild/clear'
import copy from './fbuild/copy'
import path from 'path'

export default async function run(_opts = {}, isBuild) {
  try {
    const appDir = _opts.appDir || path.normalize(process.cwd());
    const OPTS = opts.set({ ..._opts, appDir, isBuild })

    log.setLogging(OPTS)
    log('run', OPTS)

    npm.init(OPTS)
    cache.setBaseDir(OPTS.dir)
    compiler('init', OPTS)
    await initConfig()

    if (OPTS.build) {
      console.log("\nBuilding %s\n".bold, OPTS.name + '.js')

      await clear.buildDir()

      copy.assets()

      // run our pipeline once manually
      gulp.buildScripts()
      await gulp.afterFirstBuild()

      if (OPTS.watch)
        gulp.watchForBuild()
      else
        process.exit()
    }
    else {
      log('running...')
      await clear.outDir()
      await server()
      bridge.start()
      gulp.buildScripts()
      await gulp.afterFirstBuild()
      // openInBrowser()
      watchingMessage()
    }

    return opts.get()
  }
  catch(e) {
    if (!e.silent)
      handleError(e)
  }
}
