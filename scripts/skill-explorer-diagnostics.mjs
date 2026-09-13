import { loadOperationState } from "../extensions/skill-explorer/lib/config.mjs";
import { createOperationDiagnosticReport } from "../extensions/skill-explorer/lib/diagnostics.mjs";

const records = await loadOperationState();
console.log(JSON.stringify(createOperationDiagnosticReport(records), null, 2));
