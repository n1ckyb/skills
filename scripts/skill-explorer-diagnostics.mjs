#!/usr/bin/env node
import process from "node:process";
import { loadOperationState } from "../extensions/skill-explorer/lib/config.mjs";
import {
    createOperationDiagnosticReport,
    parseDiagnosticWindow,
    normalizeOriginFilter,
    DIAGNOSTIC_WINDOWS,
    DEFAULT_DIAGNOSTIC_WINDOW,
    DEFAULT_ORIGIN_FILTER,
    KNOWN_ORIGINS
} from "../extensions/skill-explorer/lib/diagnostics.mjs";

function printHelp() {
    console.log(`Skill Explorer Diagnostics CLI

Usage:
  npm run diagnostics [-- [options]]
  node scripts/skill-explorer-diagnostics.mjs [options]

Time Window Options:
  --window, -w <window>   Filter records by time window ('1h', '24h', '7d', 'all'). Default: 'all'.
  --hour, -1h             Shorthand for --window 1h (recent hour).
  --day, -24h             Shorthand for --window 24h (recent day).
  --all                   Shorthand for --window all (all retained history, default).
  --all-windows           Output matrix of diagnostic reports across standard windows (1h, 24h, all).

Origin / Environment Options:
  --origin, -o <origin>   Filter records by origin ('production', 'development', 'test', 'all'). Default: 'all'.
  --prod                  Shorthand for --origin production.
  --dev                   Shorthand for --origin development.
  --test                  Shorthand for --origin test.
  --all-origins           Output matrix of diagnostic reports across origins (production, development, test, all).

General Options:
  --help, -h              Display this help message.

Default behavior:
  Retains and evaluates all historical records stored in local JSONL state when no window or origin option is specified.
`);
}

function parseArgs(argv) {
    let window = DEFAULT_DIAGNOSTIC_WINDOW;
    let origin = DEFAULT_ORIGIN_FILTER;
    let allWindows = false;
    let allOrigins = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        } else if (arg === "--all-windows" || arg === "--matrix") {
            allWindows = true;
        } else if (arg === "--all-origins") {
            allOrigins = true;
        } else if (arg === "--hour" || arg === "-1h") {
            window = "1h";
        } else if (arg === "--day" || arg === "-24h") {
            window = "24h";
        } else if (arg === "--all") {
            window = "all";
        } else if (arg === "--prod" || arg === "--production") {
            origin = "production";
        } else if (arg === "--dev" || arg === "--development") {
            origin = "development";
        } else if (arg === "--test") {
            origin = "test";
        } else if (arg === "--window" || arg === "-w") {
            if (i + 1 < argv.length) {
                window = argv[++i];
            } else {
                console.error("Error: --window requires a window parameter (e.g. '1h', '24h', '7d', 'all').");
                process.exit(1);
            }
        } else if (arg.startsWith("--window=")) {
            window = arg.slice("--window=".length);
        } else if (arg.startsWith("-w=")) {
            window = arg.slice("-w=".length);
        } else if (arg === "--origin" || arg === "-o") {
            if (i + 1 < argv.length) {
                origin = argv[++i];
            } else {
                console.error("Error: --origin requires an origin parameter ('production', 'development', 'test', 'all').");
                process.exit(1);
            }
        } else if (arg.startsWith("--origin=")) {
            origin = arg.slice("--origin=".length);
        } else if (arg.startsWith("-o=")) {
            origin = arg.slice("-o=".length);
        } else if (!arg.startsWith("-") && i === 0) {
            // Positional window argument
            window = arg;
        } else {
            console.error(`Error: Unrecognized option '${arg}'. Run with --help for usage.`);
            process.exit(1);
        }
    }

    return { window, origin, allWindows, allOrigins };
}

const args = process.argv.slice(2);
const { window, origin, allWindows, allOrigins } = parseArgs(args);

try {
    const records = await loadOperationState();

    if (allOrigins && allWindows) {
        const matrix = {};
        for (const org of ["production", "development", "test", "all"]) {
            matrix[org] = {};
            for (const win of ["1h", "24h", "all"]) {
                matrix[org][win] = createOperationDiagnosticReport(records, { origin: org, window: win });
            }
        }
        console.log(JSON.stringify(matrix, null, 2));
    } else if (allOrigins) {
        const matrix = {};
        for (const org of ["production", "development", "test", "all"]) {
            matrix[org] = createOperationDiagnosticReport(records, { origin: org, window });
        }
        console.log(JSON.stringify(matrix, null, 2));
    } else if (allWindows) {
        const matrix = {};
        for (const win of ["1h", "24h", "all"]) {
            matrix[win] = createOperationDiagnosticReport(records, { origin, window: win });
        }
        console.log(JSON.stringify(matrix, null, 2));
    } else {
        const report = createOperationDiagnosticReport(records, { origin, window });
        console.log(JSON.stringify(report, null, 2));
    }
} catch (err) {
    console.error(`Failed to generate diagnostic report: ${err.message}`);
    process.exit(1);
}
