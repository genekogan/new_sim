import { DatabaseSync } from "node:sqlite";
for (const f of process.argv.slice(2)) { const d = new DatabaseSync(f, { readOnly: true }); console.log(Object.values(d.prepare("PRAGMA quick_check").get())[0], f); d.close(); }
