#!/usr/bin/env node
import process from "node:process";
import { loadOperationState } from "../extensions/skill-explorer/lib/config.mjs";
import {
    createOperationDiagnosticReport,
    parseDiagnosticWindow,
    DIAGNOSTIC_WINDOWS,
    DEFAULT_DIAGNOSTIC_WINDOW
} from "../extensions/skill-explorer/lib/diagnostics.mjs";

function printHelp() {
    console.log(`Skill Explorer Diagnostics CLI

Usage:
  npm run diagnostics [-- [options]]
  node scripts/skill-explorer-diagnostics.mjs [options]

Options:
  --window, -w <window>   Filter records by time window ('1h', '24h', '7d', 'all'). Default: 'all'.
  --hour                  Shorthand for --window 1h (recent hour).
  --day                   Shorthand for --window 24h (recent day).
  --all                   Shorthand for --window all (all retained history, default).
  --all-windows           Output matrix of diagnostic reports across standard windows (1h, 24h, all).
  --help, -h              Display this help message.

Default behavior:
  Retains and evaluates all historical records stored in local JSONL state when no window option is specified.
`);
}

function parseArgs(argv) {
    let window = DEFAULT_DIAGNOSTIC_WINDOW;
    let allWindows = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        } else if (arg === "--all-windows" || arg === "--matrix") {
            allWindows = true;
        } else if (arg === "--hour" || arg === "-1h") {
            window = "1h";
        } else if (arg === "--day" || arg === "-24h") {
            window = "24h";
        } else if (arg === "--all") {
            window = "all";
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
        } else if (!arg.startsWith("-") && i === 0) {
            // Positional window argument
            window = arg;
        } else {
            console.error(`Error: Unrecognized option '${arg}'. Run with --help for usage.`);
            process.exit(1);
        }
    }

    return { window, allWindows };
}

const args = process.argv.slice(2);
const { window, allWindows } = parseArgs(args);

try {
    const records = await loadOperationState();
    if (allWindows) {
        const matrix = {};
        for (const win of ["1h", "24h", "all"]) {
            matrix[win] = createOperationDiagnosticReport(records, { window: win });
        }
        console.log(JSON.stringify(matrix, null, 2));
    } else {
        const report = createOperationDiagnosticReport(records, { window });
        console.log(JSON.stringify(report, null, 2));
    }
} catch (err) {
    console.error(`Failed to generate diagnostic report: ${err.message}`);
    process.exit(1);
}
