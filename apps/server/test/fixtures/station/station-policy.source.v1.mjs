// Executable G003 selection proposal only. Trusted Core public inputs; never a
// client/camera/Soul selector. Not imported by the player or server bootstrap.
export const STATION_POLICY_REVISION = 'two-piece-public-gathering/1';
export const STATION_CATALOG_REVISION = 'score/3b806f2084d5dcefcf9a2282828765657bd74220/starfield-zoning/1';
const BPM = Object.freeze({starfield:60,'zoning-board':108});
const fields = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => names.includes(key));
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;
export function selectStation(input) {
  if (!fields(input,['worldId','tick','dtSeconds','situation','energy','previous','catalogRevision']) ||
      input.catalogRevision !== STATION_CATALOG_REVISION ||
      !text(input.worldId) || !Number.isSafeInteger(input.tick) || input.tick < 0 ||
      !Number.isFinite(input.dtSeconds) || input.dtSeconds <= 0 || input.dtSeconds > 1 ||
      !['ordinary','gathering'].includes(input.situation) ||
      !Number.isFinite(input.energy) || input.energy < 0 || input.energy > 1)
    throw new Error('Unsupported public station input');
  const previous = input.previous;
  if (previous !== null) {
    if (!fields(previous,['worldId','cueId','pieceId','startTick','cycleCount','policyRevision','catalogRevision','dtSeconds']) ||
        previous.catalogRevision !== STATION_CATALOG_REVISION || previous.dtSeconds !== input.dtSeconds ||
        previous.worldId !== input.worldId || !text(previous.cueId) ||
        !Object.hasOwn(BPM,previous.pieceId) || previous.policyRevision !== STATION_POLICY_REVISION ||
        !Number.isSafeInteger(previous.startTick) || previous.startTick < 0 || previous.startTick > input.tick ||
        previous.cycleCount !== 4)
      throw new Error('Unsupported previous station cue');
    const beat = (input.tick - previous.startTick) * input.dtSeconds * BPM[previous.pieceId] / 60;
    if (beat < 32 * previous.cycleCount)
      return {kind:'retain',cueId:previous.cueId,policyRevision:STATION_POLICY_REVISION};
  }
  return {kind:'start',pieceId:input.situation === 'gathering' ? 'zoning-board' : 'starfield',
    cycleCount:4,policyRevision:STATION_POLICY_REVISION};
}
