#!/usr/bin/env node
import { runCreate } from '../src/cli.mjs'
runCreate(process.argv.slice(2)).then((code) => process.exit(code || 0))
