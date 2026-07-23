/**
 * helpers/pcCodeHelper.js
 *
 * PC-code numbering + RM/RO reporting-rule helpers.
 *
 * Numbering scheme — 12-digit string, six 2-digit levels below the root:
 *   root            000000000000
 *   level 1         010000000000, 020000000000, …   (child of root)
 *   level 2         010100000000, 010200000000, …   (child of 010000000000)
 *   …
 *   level 6         …………………………01                    (deepest supported)
 * Read the code in 2-digit groups. A code's "slot" is its first `00` group from the
 * left; that slot is where its children are numbered. Up to 99 children per node,
 * and up to 6 levels of hierarchy below the root.
 */

const ROOT_CODE = '000000000000';
const WIDTH = 12;         // total digits (6 two-digit levels below root)
const GROUP = 2;          // digits per level
const MAX_SLOT = 99;      // 01..99 per level

// Whether a string is a valid PC code (exactly WIDTH digits).
const CODE_RE = new RegExp(`^\\d{${WIDTH}}$`);

// Split "010200000000" -> ['01','02','00','00','00','00']
function groups(code) {
  const out = [];
  for (let i = 0; i < WIDTH; i += GROUP) out.push(code.slice(i, i + GROUP));
  return out;
}

// Index of the parent's first "00" group (the slot its children occupy), or -1 if full depth.
function childSlotIndex(parentCode) {
  const g = groups(parentCode);
  return g.findIndex(x => x === '00');
}

/**
 * Compute the next child code for a parent, given its existing children's codes.
 * Throws Error with a clear message when the level is full or max depth is reached.
 */
function nextChildCode(parentCode, existingSiblingCodes = []) {
  if (!CODE_RE.test(parentCode)) {
    throw new Error(`Invalid parent PC code "${parentCode}"`);
  }
  const slot = childSlotIndex(parentCode);
  if (slot === -1) {
    throw new Error('Maximum PC-code depth reached — this position cannot have sub-positions');
  }

  // Highest slot value already used among direct children.
  let max = 0;
  for (const sib of existingSiblingCodes) {
    if (!CODE_RE.test(sib)) continue;
    const val = parseInt(groups(sib)[slot], 10);
    if (val > max) max = val;
  }

  const next = max + 1;
  if (next > MAX_SLOT) {
    throw new Error(`This position already has the maximum of ${MAX_SLOT} direct reports`);
  }

  const g = groups(parentCode);
  g[slot] = String(next).padStart(GROUP, '0');
  return g.join('');
}

// ── RM/RO reporting rule ────────────────────────────────────────────────────
// Allowed child→parent links (by the CURRENT HOLDER's tag): RM→RM and RO→RM.
// i.e. the parent's holder must be an RM. An RO-held code can never be a parent.

const RM = 'RM';
const RO = 'RO';

/**
 * Given the child holder's tag and the parent holder's tag, is the link allowed?
 * A null/unknown tag on either side is treated as not-allowed (caller decides for
 * vacant codes — by default we block parenting under a code with no RM holder).
 */
function isReportsToAllowed(childTag, parentTag) {
  if (parentTag !== RM) return false;          // only RM positions may be parents
  return childTag === RM || childTag === RO;   // RM→RM and RO→RM
}

module.exports = { ROOT_CODE, nextChildCode, childSlotIndex, isReportsToAllowed, RM, RO };
