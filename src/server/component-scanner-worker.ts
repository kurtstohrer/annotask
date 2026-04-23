/**
 * Worker-thread entry for the component library scan. The scan does large
 * bursts of synchronous I/O (package-root walks, `readFileSync`,
 * `existsSync`, `statSync`) and CPU-bound regex/AST work, all of which
 * block Node's event loop. Running it here keeps the main thread free to
 * serve task-creation and other API requests while a scan is in progress.
 *
 * Protocol: the worker reads `projectRoot` from `workerData`, runs the
 * uncached scan once, posts the result, and exits.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { scanComponentLibrariesUncached } from './component-scanner.js'

async function run(): Promise<void> {
  if (!parentPort) return
  try {
    const result = await scanComponentLibrariesUncached(workerData.projectRoot)
    parentPort.postMessage({ ok: true, result })
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

void run()
