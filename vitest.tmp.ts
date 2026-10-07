/**
 * Global setup for every package's tests: a fresh temp folder for the run, deleted when the run ends. Many tests
 * simulate a whole match into os.tmpdir() (about 80 MB each); without this they pile up on disk run after run.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "touchline-test-"))
  // os.tmpdir() reads these on every call; the test workers start after this and inherit them.
  for (const k of ["TMPDIR", "TMP", "TEMP"]) process.env[k] = dir
  return () => rmSync(dir, { recursive: true, force: true })
}
