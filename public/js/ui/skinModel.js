// Portable skin choices shared by loadout JSON and the skin store. No art catalogue or browser state is required.
import { SKIN_LIMITS, isCharId, isSkinId } from '../../../shared/protocol.js';

/** Keep wire-valid choices, including skins whose art is currently unavailable. */
export function parseImportedSkins(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, skin] of Object.entries(raw)) {
    if (!isCharId(id) || !isSkinId(skin)) continue;
    out[id] = skin;
    if (Object.keys(out).length >= SKIN_LIMITS.entries) break;
  }
  return out;
}
