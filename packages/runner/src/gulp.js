import merge from 'merge-stream'
import multipipe from 'multipipe'
import flintTransform from 'flint-transform'
import through from 'through2'
import path from 'path'
import gulp from 'gulp'
import loadPlugins from 'gulp-load-plugins'
import bridge from './bridge'
import cache from './cache'
import build from './fbuild/build'
import unicodeToChar from './lib/unicodeToChar'
import superStream from './lib/superStream'
import compiler from './compiler'
import babel from './lib/gulp-babel'
import opts from './opts'
import log from './lib/log'
import { p, rmdir } from './lib/fns'

const $ = loadPlugins()
let lastSavedTimestamp = {}
let OPTS

const newLine = "\n"
const SCRIPTS_GLOB = [
  '[Mm]ain.js', '**/*.{js,jsf}',
  '!node_modules{,/**}',
  '!.flint{,/**}'
]

const relative = file => path.relative(opts.get('appDir'), file.path)
const time = _ => _ ? ` - ${_}ms` : ''
const out = {
  badFile: (file, err) => console.log(` ◆ ${relative(file)}`.red),
  goodFile: (file, ms) => console.log(` ✓ ${relative(file)}${time(ms)}`.bold)
}
gulp.task('build', buildScripts)

export function watchForBuild() {
  return gulp.watch(SCRIPTS_GLOB, ['build'])
}

const watchDeletes = async vinyl => {
  // bugfix. sometimes pipeline slows, but these events keep coming
  // prevent buildFinished from running early
  // (vinyl event is undefined before initial run)
  if (!vinyl.event)
    buildFinishedCheck()

  try {
    if (vinyl.event == 'unlink') {
      cache.remove(vinyl.path)
      const name = path.relative(OPTS.outDir, vinyl.path)
      await rmdir(p(OPTS.outDir, name))
      bridge.message('file:delete', { name })
    }
  }
  catch(e) {
    handleError(e)
  }
}

const $p = {
  flint: {
    pre: () => compiler('pre'),
    post: () => compiler('post')
  },
  babel: () => babel({
    jsxPragma: 'view.el',
    stage: 2,
    blacklist: ['flow', 'es6.tailCall', 'strict'],
    retainLines: true,
    comments: true,
    optional: ['bluebirdCoroutines'],
    plugins: [flintTransform({ basePath: OPTS.dir })],
    extra: {
      production: process.env.production
    }
  })
}

// userStream is optional for programmatic usage
export function buildScripts(afterEach, userStream) {
  OPTS = opts.get()
  let lastScript, curFile, lastError
  let outDest = OPTS.build ? p(OPTS.buildDir, '_') : OPTS.outDir || '.'

  // super stream watcher
  if (!OPTS.build) {
    bridge.on('super:on', ({ file }) => superStream.start(file))
    bridge.on('super:off', superStream.stop)
  }

  // gulp src stream
  const gulpSrcStream = gulp.src(SCRIPTS_GLOB)
    .pipe($.if(!OPTS.build, $.watch(SCRIPTS_GLOB, null, watchDeletes)))

  // either user or gulp stream
  const sourceStream = userStream || gulpSrcStream
  const stream = OPTS.build ? sourceStream : merge(sourceStream, superStream.stream)

  return stream
    .pipe(pipefn(resetLastFile))
    .pipe($.plumber(catchError))
    .pipe(pipefn(setLastFile))
    .pipe($p.flint.pre())
    .pipe($.sourcemaps.init())
    .pipe($p.babel())
    .pipe($p.flint.post())
    .pipe($.if(!userStream, $.rename({ extname: '.js' })))
    .pipe(pipefn(file => {
      // for spaces when outputting
      if (OPTS.build) out.goodFile(file)
    }))
    .pipe($.if(file => !OPTS.build && !file.isInternal, $.sourcemaps.write('.')))
    .pipe($.if(file => file.isInternal,
      multipipe(
        gulp.dest(p(OPTS.depsDir, 'internal')),
        $.ignore.exclude(true)
      )
    ))
    .pipe($.if(file => !file.isInternal && OPTS.build, $.concat(`${OPTS.saneName}.js`)))
    .pipe($.if(checkWriteable, gulp.dest(outDest)))
    .pipe(pipefn(afterWrite))
    // why, you ask? because... gulp watch will drop things if not
    .pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn())
    .pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn())
    .pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn())
    .pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn())

  function resetLastFile(file) {
    lastError = false
    curFile = file
    lastScript = null
    file.startTime = Date.now()
  }

  function catchError(error) {
    log('caught error')
    lastError = true
    error.timestamp = Date.now()
    out.badFile(curFile)
    logError(error, curFile)
    cache.addError(error.fileName, error)
    bridge.message('compile:error', { error })
    buildFinishedCheck()
  }

  function setLastFile(file) {
    if (OPTS.build) return
    let name = file.path.replace(OPTS.appDir, '')
    if (name.charAt(0) != '/') name = '/' + name
    lastScript = { name, compiledAt: file.startTime }
    curFile = file
  }

  function checkWriteable(file) {
    buildFinishedCheck()

    if (file.isInternal)
      return false

    file.isSourceMap = file.path.slice(file.path.length - 3, file.path.length) === 'map'

    if (file.isSourceMap)
      return true

    if (userStream || lastError)
      return false

    const endTime = Date.now() - file.startTime

    out.goodFile(file, endTime)
    log('build took ', endTime, 'ms')

    if (OPTS.build)
      return true

    const isNew = (
      !lastSavedTimestamp[file.path] ||
      file.startTime > lastSavedTimestamp[file.path]
    )

    log('is new file', isNew)
    if (isNew) {
      lastSavedTimestamp[file.path] = file.startTime
      return true
    }

    return false
  }

  function afterWrite(file) {
    if (OPTS.build) build()

    if (file.isSourceMap) return

    log('OPTS.hasRunInitialBuild', OPTS.hasRunInitialBuild)
    log('lastError', lastError)

    // after initial build
    if (OPTS.hasRunInitialBuild) {
      if (!lastError && !file.isInternal) {
        cache.removeError(file.path)
        bridge.message('script:add', lastScript)
        bridge.message('compile:success', lastScript)

        // fixed one error but have others
        const prevError = cache.getLastError()
        if (prevError)
          bridge.message('compile:error', { error: prevError })
      }
    }
  }
}

export function buildWhileRunning() {
  return new Promise((res, rej) => {
    gulp.src(['.flint/.internal/out/**/*.js'])
      .pipe($.plumber(err => {
        logError(err)
        rej(err)
      }))
      .pipe($.concat(`${OPTS.saneName}.js`))
      .pipe(gulp.dest(p(OPTS.buildDir, '_')))
      .pipe(pipefn(res))
  });
}

let buildingTimeout
function buildFinishedCheck() {
  if (!OPTS.hasRunInitialBuild) {
    log('buildFinishedCheck setTimeout')
    if (buildingTimeout) clearTimeout(buildingTimeout)
    buildingTimeout = setTimeout(() => {
      log('OPTS.hasRunInitialBuild = true')
      OPTS.hasRunInitialBuild = true

      runAfterFirstBuilds()
    }, 450)
  }
}

function logError(error, file) {
  if (error.stack || error.codeFrame)
    error.stack = unicodeToChar(error.stack || error.codeFrame);

  if (error.plugin == 'gulp-babel') {
    console.log(error.message.replace(OPTS.appDir, ''));
    if (error.name != 'TypeError' && error.loc)
      console.log('line: %s, col: %s', error.loc.line, error.loc.column);
    console.log(newLine, error.stack.split("\n").splice(0, 7).join("\n"))
  }
  else {
    console.log('ERROR', "\n", error)
    console.log(error.stack)
    log('FILE', "\n", file.contents.toString())
  }
}


/* FIRST BUILD STUFF */

let waitingForFirstBuild = []

const afterFirstBuild = () =>
  new Promise((res, rej) => {
    if (OPTS.hasRunInitialBuild) return res()
    else waitingForFirstBuild.push(res)
  })

const runAfterFirstBuilds = () =>
  waitingForFirstBuild.forEach(res => res())

/* END FIRST BUILD STUFF */


function pipefn(fn) {
  return through.obj(function(file, enc, next) {
    fn && fn(file)
    next(null, file);
  })
}

export default { buildScripts, afterFirstBuild, watchForBuild }