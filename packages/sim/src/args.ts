import { parseArgs } from "node:util"

/** A bad command line: the CLI prints the message (no stack trace) and exits with status 2. */
export class CliError extends Error {}

/** Returns an error message for a bad value, or the normalised value. */
export type Check = (name: string, value: string) => { readonly error: string } | { readonly value: string }

export interface OptionSpec {
  readonly default: string
  readonly help: string
  readonly check?: Check
}

export const integer =
  (lo: number, hi: number): Check =>
  (name, v) =>
    /^-?\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? { value: v } : { error: `--${name} must be an integer between ${lo} and ${hi}` }

export const positiveInteger: Check = (name, v) => (/^\d+$/.test(v) && Number(v) > 0 ? { value: v } : { error: `--${name} must be a positive integer` })

export const oneOf =
  (allowed: ReadonlyArray<string>): Check =>
  (name, v) =>
    allowed.includes(v) ? { value: v } : { error: `--${name} must be one of ${allowed.join(", ")}` }

/** A plain name usable as a file or folder name: letters, digits, dot, dash and underscore; no leading dot (so no "..", no paths). */
export const safeName: Check = (name, v) =>
  /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(v) ? { value: v } : { error: `--${name} must be a plain name (letters, digits, ".", "-", "_"; got "${v}")` }

/** ISO 8601 UTC date-time ("2026-10-18T14:00:00Z"); normalised to milliseconds ("…:00.000Z"). */
export const isoTime: Check = (name, v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/.exec(v)
  const t = m ? Date.parse(v) : NaN
  // Date.parse rolls invalid fields over (Feb 30 -> Mar 2); the round trip catches that.
  if (!m || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 19) !== v.slice(0, 19))
    return { error: `--${name} must be an ISO 8601 UTC time such as 2026-10-18T14:00:00Z (got "${v}")` }
  return { value: new Date(t).toISOString() }
}

export const usage = (spec: Readonly<Record<string, OptionSpec>>): string =>
  Object.entries(spec)
    .map(([k, o]) => `  --${k.padEnd(10)} ${o.help} (default: ${o.default === "" ? "none" : o.default})`)
    .join("\n")

/** Strict parsing: unknown options, missing values, stray arguments and bad values all throw CliError. */
export const parseCli = <S extends Readonly<Record<string, OptionSpec>>>(argv: ReadonlyArray<string>, spec: S): { [K in keyof S]: string } => {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: [...argv],
      options: Object.fromEntries(Object.keys(spec).map((k) => [k, { type: "string" as const }])),
      strict: true,
      allowPositionals: false
    })
  } catch (e) {
    throw new CliError(e instanceof Error ? e.message : String(e))
  }
  const out: Record<string, string> = {}
  for (const [k, o] of Object.entries(spec)) {
    const raw = parsed.values[k]
    const v = typeof raw === "string" ? raw : o.default
    if (typeof raw === "string" && raw.startsWith("--")) throw new CliError(`--${k} needs a value`)
    const r = o.check && v !== "" ? o.check(k, v) : { value: v }
    if ("error" in r) throw new CliError(r.error)
    out[k] = r.value
  }
  return out as { [K in keyof S]: string }
}

/**
 * Parse argv for a CLI: prints usage on --help, and turns CliError (and any error class in `userErrors`)
 * into a one-line message with exit status 2.
 */
export const cliOptions = <S extends Readonly<Record<string, OptionSpec>>>(title: string, spec: S, argv: ReadonlyArray<string> = process.argv.slice(2)): { [K in keyof S]: string } => {
  if (argv.includes("--help")) {
    console.log(`${title}\n\nOptions:\n${usage(spec)}`)
    process.exit(0)
  }
  return exitOnUserError(() => parseCli(argv, spec))
}

/** Run `f`; a CliError (or an error of one of `userErrors`) prints its message and exits 2. */
export const exitOnUserError = <A>(f: () => A, userErrors: ReadonlyArray<new (...a: never[]) => Error> = []): A => {
  try {
    return f()
  } catch (e) {
    if (e instanceof CliError || userErrors.some((c) => e instanceof c)) {
      console.error((e as Error).message)
      process.exit(2)
    }
    throw e
  }
}
