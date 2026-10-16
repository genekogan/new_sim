import { lstat, open } from 'node:fs/promises';

/** Reserve a new audit file before credentials/network work; reruns must choose a fresh path. */
export async function withNewReceipt(file, operation) {
  const handle = await open(file, 'wx', 0o600);
  try {
    const created = await handle.stat();
    const checkPath = async () => {
      const current = await lstat(file);
      if (!current.isFile() || current.dev !== created.dev || current.ino !== created.ino) throw Error('Receipt path changed during the operation');
    };
    let result;
    try { result = await operation(); }
    catch (error) {
      // A failed upload may have published some objects. Retain its attempt instead of erasing the audit file.
      await checkPath();
      await handle.writeFile(JSON.stringify({ version: 1, at: new Date().toISOString(), ok: false,
        status: 'incomplete', note: 'Operation failed; partial remote work may exist. See the command error; rerun with a new receipt path.' }, null, 2) + '\n');
      await handle.sync();
      throw error;
    }
    await checkPath();
    await handle.writeFile(JSON.stringify(result, null, 2) + '\n');
    await handle.sync();
    await checkPath();
    return result;
  } finally { await handle.close(); }
}
