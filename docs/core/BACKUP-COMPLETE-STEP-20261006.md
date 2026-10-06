# Complete SQLite backup step

Db.backupTo uses the existing Node SQLite backup API with rate2147483647,
copying the current database in one complete step within supported database size.
This avoids repeatedly restarting a100-page incremental copy while another WAL
connection writes. It keeps the existing source/destination API and retention.
No source data, spend, claims, transaction policy or protected resource changes.

Node documents that other-connection mutations restart incremental backups:
https://nodejs.org/api/sqlite.html#sqlitebackupsourcedb-path-options
The rate must be positive; no unsupported negative/all-pages argument is used.

Meaningful local25MB WAL fixture with a second live writer passes within230ms;
backup integrity_check=ok and all1500full payload rows reopen consistently.
Types pass. This is a bounded local measurement, not a universal backup/drain SLA
for arbitrary archive size or remote hardware. PM matches stop budget to measured
actual candidate drain and retains backups before operating on live data.
