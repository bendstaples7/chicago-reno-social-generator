#!/usr/bin/env node

/**
 * One-time script to reorder the product_catalog table by renovation phase.
 *
 * Uses deterministic keyword matching (no AI) to categorize each product into
 * one of 25 renovation phases and assigns sequential sort_order values within
 * each phase's designated range.
 *
 * Run from the worker/ directory:
 *   node scripts/reorder-catalog-by-renovation.mjs
 */

import { execSync } from 'child_process';

// ─── Renovation Phases ───────────────────────────────────────────────────────
// Each phase has: name, sort_order range [start, end], and keyword matchers.
// Matchers are tested in order — first match wins. More specific patterns
// (e.g., "Carpentry: Door") are placed in their trade phase BEFORE the generic
// "Carpentry:" catch-all to avoid mis-categorization.

const PHASES = [
  // ── 1. Design & Planning (0-19) ──
  {
    name: 'Design & Planning',
    range: [0, 19],
    match: (n) =>
      /room design/i.test(n) ||
      /architectural plan/i.test(n),
  },

  // ── 2. Permits & Admin (20-39) ──
  {
    name: 'Permits & Admin',
    range: [20, 39],
    match: (n) =>
      /^permit$/i.test(n) ||
      /parking expense/i.test(n) ||
      /travel surcharge/i.test(n) ||
      /walkup surcharge/i.test(n) ||
      /handyman surcharge/i.test(n) ||
      /spam request/i.test(n) ||
      /tenant coordination/i.test(n) ||
      /comed coordination/i.test(n) ||
      /condo coordination/i.test(n) ||
      /coordination charge/i.test(n),
  },

  // ── 3. Demo (40-79) ──
  {
    name: 'Demo',
    range: [40, 79],
    match: (n) =>
      /^demo$/i.test(n) ||
      /^demo[:\s]/i.test(n) ||
      /materials:\s*demo/i.test(n) ||
      /^cement$/i.test(n),
  },

  // ── 4. Structural / Framing (80-139) ──
  {
    name: 'Structural / Framing',
    range: [80, 139],
    match: (n) =>
      /^framing/i.test(n) ||
      /carpentry:\s*framing/i.test(n) ||
      /carpentry:\s*structural/i.test(n) ||
      /framing and drywall adjustment/i.test(n) ||
      /materials:\s*framing/i.test(n) ||
      /materials:\s*header$/i.test(n) ||
      /materials:\s*lvl/i.test(n) ||
      /materials:\s*lvp/i.test(n) ||
      /materials:\s*kitchen peninsula framing/i.test(n) ||
      /materials:\s*screen framing/i.test(n) ||
      /carpentry:\s*screen framing/i.test(n) ||
      /carpentry:\s*install blocking/i.test(n),
  },

  // ── 5. Roofing (140-169) ──
  {
    name: 'Roofing',
    range: [140, 169],
    match: (n) =>
      /^roofing$/i.test(n) ||
      /exterior:\s*roofing/i.test(n) ||
      /carpentry:\s*roofing/i.test(n) ||
      /materials:\s*roofing/i.test(n) ||
      /material:\s*shingles/i.test(n) ||
      /materials:\s*structural roof/i.test(n),
  },

  // ── 6. Exterior (170-219) ──
  {
    name: 'Exterior',
    range: [170, 219],
    match: (n) =>
      /^exterior/i.test(n) ||
      /exteior caulk/i.test(n) ||
      /materials:\s*siding/i.test(n) ||
      /materials:\s*fencing/i.test(n) ||
      /materials:\s*facia/i.test(n) ||
      /materials:\s*gutters/i.test(n) ||
      /materials:\s*guardrail/i.test(n) ||
      /materials:\s*french drain/i.test(n) ||
      /materials:\s*sidewalk/i.test(n) ||
      /materials:\s*cedar plank/i.test(n) ||
      /materials:\s*composite decking/i.test(n) ||
      /materials:\s*deck railing/i.test(n) ||
      /^gutter repair$/i.test(n) ||
      /masonry/i.test(n) ||
      /materials:\s*brick repair/i.test(n) ||
      /materials:\s*tuckpointing/i.test(n) ||
      /materials:\s*concrete$/i.test(n) ||
      /materials:\s*footing/i.test(n) ||
      /materials:\s*vapor barrier/i.test(n) ||
      /carpentry:\s*deck/i.test(n) ||
      /carpentry:\s*front porch/i.test(n) ||
      /carpentry:\s*exterior post/i.test(n) ||
      /carpentry:\s*exterior temporary/i.test(n) ||
      /carpentry:\s*replace fence/i.test(n) ||
      /carpentry:\s*railing repair/i.test(n) ||
      /concrete:\s*install new sidewalk/i.test(n),
  },

  // ── 7. Rough Plumbing (220-269) ──
  {
    name: 'Rough Plumbing',
    range: [220, 269],
    match: (n) =>
      /^rough plumbing/i.test(n) ||
      /plumbing:\s*rough/i.test(n) ||
      /plumbing:\s*misc rough/i.test(n) ||
      /plumbing:\s*stack repair/i.test(n) ||
      /plumbing:\s*drain line/i.test(n) ||
      /plumbing:\s*drain flange/i.test(n) ||
      /plumbing:\s*drain and water/i.test(n) ||
      /plumbing:\s*ejector/i.test(n) ||
      /plumbing:\s*swap galvanized/i.test(n) ||
      /plumbing:\s*swap hot and cold/i.test(n) ||
      /plumbing:\s*cap gas/i.test(n) ||
      /plumbing:\s*gas line/i.test(n) ||
      /plumbing:\s*redirect stove gas/i.test(n) ||
      /plumbing:\s*relocate stove gas/i.test(n) ||
      /plumbing:\s*re-connect gas/i.test(n) ||
      /plumbing:\s*install fridge water/i.test(n) ||
      /plumbing:\s*leak repair/i.test(n) ||
      /plumbing:\s*certified/i.test(n) ||
      /plumbing:\s*condo water/i.test(n) ||
      /plumbing:\s*install hot water/i.test(n) ||
      /plumbing:\s*install water heater/i.test(n) ||
      /plumbing:\s*hot water heater/i.test(n) ||
      /plumbing:\s*install built in/i.test(n) ||
      /plumbing:\s*install rough in/i.test(n) ||
      /materials:\s*rough plumbing/i.test(n) ||
      /materials:\s*copper water/i.test(n) ||
      /materials:\s*plumbing shut off/i.test(n) ||
      /materials:\s*hot water heater/i.test(n) ||
      /materials:\s*stainless steel laundry/i.test(n) ||
      /materials:\s*poly injection/i.test(n),
  },

  // ── 8. Rough Electrical (270-319) ──
  {
    name: 'Rough Electrical',
    range: [270, 319],
    match: (n) =>
      /^rough electrical$/i.test(n) ||
      /electrical:\s*rough/i.test(n) ||
      /electrical:\s*run new circuit/i.test(n) ||
      /electrical:\s*run new light switch/i.test(n) ||
      /electrical:\s*run led/i.test(n) ||
      /electrical:\s*replacement of romex/i.test(n) ||
      /electrical:\s*switch rewiring/i.test(n) ||
      /electrical:\s*upgrade electric panel/i.test(n) ||
      /electrical:\s*under cabinet lighting/i.test(n) ||
      /electrical:\s*schluter/i.test(n) ||
      /materials:\s*rough electric/i.test(n) ||
      /materials:\s*electrical romex/i.test(n) ||
      /materials:\s*electrical panel/i.test(n) ||
      /materials:\s*misc electrical/i.test(n) ||
      /materials:\s*outlet$/i.test(n) ||
      /materials:\s*gfci outlet/i.test(n) ||
      /materials:\s*light switch$/i.test(n) ||
      /materials:\s*panel cover fasteners/i.test(n),
  },

  // ── 9. HVAC / Insulation (320-359) ──
  {
    name: 'HVAC / Insulation',
    range: [320, 359],
    match: (n) =>
      /^hvac/i.test(n) ||
      /^insulation/i.test(n) ||
      /material:\s*fiberglass/i.test(n) ||
      /materials:\s*insulation/i.test(n) ||
      /materials:\s*ductwork/i.test(n) ||
      /materials:\s*furnace/i.test(n) ||
      /materials:\s*dryer vent$/i.test(n) ||
      /materials:\s*ac units/i.test(n) ||
      /materials:\s*radiator/i.test(n),
  },

  // ── 10. Drywall (360-399) ──
  {
    name: 'Drywall',
    range: [360, 399],
    match: (n) =>
      /^drywall/i.test(n) ||
      /garage hole repair/i.test(n) ||
      /materials:\s*drywall/i.test(n) ||
      /materials:\s*mold remediation/i.test(n),
  },

  // ── 11. Flooring (400-459) ──
  {
    name: 'Flooring',
    range: [400, 459],
    match: (n) =>
      /^flooring/i.test(n) ||
      /^sub\s*floor/i.test(n) ||
      /^floor deep clean/i.test(n) ||
      /^install new concrete sub\s*floor/i.test(n) ||
      /^install new plywood subfloor/i.test(n) ||
      /^pour new concrete subfloor/i.test(n) ||
      /carpentry:\s*flooring repair/i.test(n) ||
      /carpentry:\s*carpet installation/i.test(n) ||
      /carpentry:\s*install new plywood sub/i.test(n) ||
      /carpentry:\s*subfloor/i.test(n) ||
      /carpentry:\s*oak tread/i.test(n) ||
      /carpentry:\s*install oak treads/i.test(n) ||
      /carpentry:\s*install new treads/i.test(n) ||
      /carpentry:\s*stairwell rebuild/i.test(n) ||
      /materials:\s*hardwood floor/i.test(n) ||
      /materials:\s*laminate flooring/i.test(n) ||
      /materials:\s*vinyl flooring/i.test(n) ||
      /materials:\s*floor sealant/i.test(n) ||
      /materials:\s*plywood/i.test(n) ||
      /materials:\s*stairs/i.test(n) ||
      /materials:\s*carpet shampoo/i.test(n) ||
      /materials:\s*self leveling/i.test(n) ||
      /materials:\s*cork underlayment/i.test(n),
  },

  // ── 12. Tile (460-519) ──
  {
    name: 'Tile',
    range: [460, 519],
    match: (n) =>
      /^tile/i.test(n) ||
      /materials:\s*backsplash tile/i.test(n) ||
      /materials:\s*bathroom floor tile/i.test(n) ||
      /materials:\s*bathroom floor grout/i.test(n) ||
      /materials:\s*bathroom tile/i.test(n) ||
      /materials:\s*kitchen tile/i.test(n) ||
      /materials:\s*shower wall tile/i.test(n) ||
      /materials:\s*mosaic shower/i.test(n) ||
      /materials:\s*large format backsplash/i.test(n) ||
      /materials:\s*grout$/i.test(n) ||
      /materials:\s*durock/i.test(n) ||
      /materials:\s*redgard/i.test(n) ||
      /materials:\s*schluter/i.test(n) ||
      /materials:\s*shower curb/i.test(n) ||
      /materials:\s*shower edging/i.test(n) ||
      /materials:\s*shower niche/i.test(n) ||
      /materials:\s*shower pan/i.test(n) ||
      /materials:\s*wall tile sealant/i.test(n) ||
      /tub reglaze/i.test(n),
  },

  // ── 13. Countertops (520-549) ──
  {
    name: 'Countertops',
    range: [520, 549],
    match: (n) =>
      /^countertop/i.test(n),
  },

  // ── 14. Cabinets & Carpentry (550-649) ──
  // NOTE: Specific carpentry sub-items (doors, windows, trim, vanities, flooring)
  // are matched by their trade phases ABOVE. This catches remaining general carpentry.
  {
    name: 'Cabinets & Carpentry',
    range: [550, 649],
    match: (n) =>
      /^cabinet/i.test(n) ||
      /painting:\s*cabinet/i.test(n) ||
      /materials:\s*cabinet/i.test(n) ||
      /materials:\s*finish carpentry/i.test(n) ||
      /materials:\s*misc carpentry/i.test(n) ||
      /materials:\s*wainscotting/i.test(n) ||
      /materials:\s*access panel/i.test(n) ||
      /materials:\s*basic wooden handrail/i.test(n) ||
      /materials:\s*towel bar/i.test(n) ||
      /materials:\s*bathroom mirror/i.test(n) ||
      // Generic carpentry catch-all (items not matched by specific trade phases above)
      /^carpentry/i.test(n),
  },

  // ── 15. Doors & Windows (650-699) ──
  {
    name: 'Doors & Windows',
    range: [650, 699],
    match: (n) =>
      /materials:\s*prehung door/i.test(n) ||
      /materials:\s*door casing/i.test(n) ||
      /materials:\s*door hardware/i.test(n) ||
      /materials:\s*door threshold/i.test(n) ||
      /materials:\s*door seal/i.test(n) ||
      /materials:\s*window$/i.test(n) ||
      /materials:\s*window casing/i.test(n) ||
      /materials:\s*window screen/i.test(n),
  },

  // ── 16. Painting (700-749) ──
  {
    name: 'Painting',
    range: [700, 749],
    match: (n) =>
      /^interior painting/i.test(n) ||
      /^exterior painting$/i.test(n) ||
      /^paint$/i.test(n) ||
      /painting:\s*/i.test(n) ||
      /materials:\s*interior paint/i.test(n) ||
      /materials:\s*exterior paint/i.test(n) ||
      /materials:\s*paint supplies/i.test(n) ||
      /materials:\s*wallpaper/i.test(n) ||
      /misc:\s*wallpaper/i.test(n),
  },

  // ── 17. Trim & Molding (750-789) ──
  {
    name: 'Trim & Molding',
    range: [750, 789],
    match: (n) =>
      /materials:\s*baseboard/i.test(n) ||
      /materials:\s*shoe trim/i.test(n) ||
      /materials:\s*molding/i.test(n),
  },

  // ── 18. Plumbing Fixtures (790-839) ──
  {
    name: 'Plumbing Fixtures',
    range: [790, 839],
    match: (n) =>
      /plumbing:\s*toilet/i.test(n) ||
      /plumbing:\s*install new tub/i.test(n) ||
      /plumbing:\s*install.*sink/i.test(n) ||
      /plumbing:\s*.*faucet/i.test(n) ||
      /plumbing:\s*install new shower fixture/i.test(n) ||
      /plumbing:\s*shower mixer/i.test(n) ||
      /plumbing:\s*shower valve/i.test(n) ||
      /plumbing:\s*two way diverter/i.test(n) ||
      /plumbing:\s*fixture repair/i.test(n) ||
      /plumbing:\s*install new garbage/i.test(n) ||
      /plumbing:\s*sink unclog/i.test(n) ||
      /plumbing:\s*install.*wax ring/i.test(n) ||
      /plumbing:\s*repair toilet/i.test(n) ||
      /plumbing:\s*finish plumbing/i.test(n) ||
      /materials:\s*toilet/i.test(n) ||
      /materials:\s*vanity$/i.test(n) ||
      /materials:\s*bathroom sink faucet/i.test(n) ||
      /materials:\s*kitchen sink faucet/i.test(n) ||
      /materials:\s*kitchen sink$/i.test(n) ||
      /materials:\s*shower fixture/i.test(n) ||
      /materials:\s*tub rough/i.test(n) ||
      /materials:\s*garbage disposal/i.test(n) ||
      /materials:\s*2 way diverter/i.test(n) ||
      /^caulk bathroom sink/i.test(n) ||
      /^caulk shower surround/i.test(n),
  },

  // ── 19. Electrical Fixtures (840-889) ──
  {
    name: 'Electrical Fixtures',
    range: [840, 889],
    match: (n) =>
      // "Electrical:" items that are NOT rough electrical (already matched above)
      /electrical:\s*/i.test(n) ||
      // "Electric:" prefix (typo variant without "al")
      /^electric:\s*/i.test(n) ||
      /^swap light bulb/i.test(n) ||
      /^unit 2 doorbell/i.test(n) ||
      /materials:\s*recessed lights/i.test(n) ||
      /materials:\s*light fixture/i.test(n) ||
      /materials:\s*smoke/i.test(n),
  },

  // ── 20. Appliances (890-929) ──
  {
    name: 'Appliances',
    range: [890, 929],
    match: (n) =>
      /^appliance/i.test(n),
  },

  // ── 21. Shower Doors & Glass (930-959) ──
  {
    name: 'Shower Doors & Glass',
    range: [930, 959],
    match: (n) =>
      /shower door/i.test(n) ||
      /glass.*shower/i.test(n) ||
      /^install glass shower/i.test(n) ||
      /^install new stock shower/i.test(n) ||
      /^remove existing shower doors/i.test(n) ||
      /^glass half shower/i.test(n) ||
      /materials:\s*shower door gasket/i.test(n) ||
      /misc:\s*install non custom over tub/i.test(n) ||
      /misc:\s*re install glass partition/i.test(n) ||
      /misc:\s*replace glass shower/i.test(n),
  },

  // ── 22. Misc / Handyman (960-999) ──
  {
    name: 'Misc / Handyman',
    range: [960, 999],
    match: (n) =>
      /^misc/i.test(n) ||
      /materials:\s*caulk$/i.test(n) ||
      /materials:\s*fastners/i.test(n),
  },

  // ── 23. Cleanup (1000-1019) ──
  {
    name: 'Cleanup',
    range: [1000, 1019],
    match: (n) =>
      /debris removal/i.test(n) ||
      /materials:\s*contractor bags/i.test(n) ||
      /cleaning:/i.test(n),
  },

  // ── 24. General Materials (1020-1039) ──
  {
    name: 'General Materials',
    range: [1020, 1039],
    match: (n) =>
      /^materials$/i.test(n) ||
      /^tool rental/i.test(n) ||
      /^shopping time/i.test(n),
  },

  // ── 25. Labor & Catch-all (1040-1059) ──
  {
    name: 'Labor & Catch-all',
    range: [1040, 1059],
    match: (n) =>
      /^labor$/i.test(n),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function runWrangler(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute DB --local --json --command "${escaped}"`;
  const out = execSync(cmd, { cwd: process.cwd(), encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

function categorize(name) {
  for (const phase of PHASES) {
    if (phase.match(name)) return phase;
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log('=== Product Catalog Reorder by Renovation Phase ===\n');

// 1. Read all products
console.log('Reading products from product_catalog...');
const products = runWrangler('SELECT id, name, sort_order, category FROM product_catalog ORDER BY name');
console.log(`Found ${products.length} products.\n`);

// 2. Categorize each product
const phaseProducts = new Map(); // phaseName -> [{id, name, isMaterial}]
const uncategorized = [];

for (const p of products) {
  const phase = categorize(p.name);
  if (!phase) {
    uncategorized.push(p);
    continue;
  }
  if (!phaseProducts.has(phase.name)) {
    phaseProducts.set(phase.name, []);
  }
  // Determine if this is a material item (materials sort after labor within a phase)
  const isMaterial = /^materials?:/i.test(p.name);
  phaseProducts.get(phase.name).push({ ...p, isMaterial });
}

// 3. Handle uncategorized — put them in Labor & Catch-all
if (uncategorized.length > 0) {
  console.log(`⚠️  ${uncategorized.length} product(s) didn't match any phase — assigning to "Labor & Catch-all":`);
  for (const u of uncategorized) {
    console.log(`   - ${u.name}`);
    if (!phaseProducts.has('Labor & Catch-all')) {
      phaseProducts.set('Labor & Catch-all', []);
    }
    phaseProducts.get('Labor & Catch-all').push({ ...u, isMaterial: /^materials?:/i.test(u.name) });
  }
  console.log();
}

// 4. Assign sort_order values
const updates = []; // {id, sort_order}

for (const phase of PHASES) {
  const items = phaseProducts.get(phase.name) || [];
  if (items.length === 0) continue;

  // Sort: labor/service items first (alphabetically), then materials (alphabetically)
  items.sort((a, b) => {
    if (a.isMaterial !== b.isMaterial) return a.isMaterial ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  const [rangeStart, rangeEnd] = phase.range;
  const available = rangeEnd - rangeStart + 1;

  if (items.length > available) {
    console.error(`❌ Phase "${phase.name}" has ${items.length} items but only ${available} slots (${rangeStart}-${rangeEnd}). Aborting to prevent duplicate sort_order values across phases.`);
    console.error('   Fix: increase the range for this phase or recategorize some products.');
    process.exit(1);
  }

  for (let i = 0; i < items.length; i++) {
    updates.push({ id: items[i].id, sort_order: rangeStart + i });
  }
}

// 5. Print summary
console.log('Phase Assignment Summary:');
console.log('─'.repeat(60));
for (const phase of PHASES) {
  const items = phaseProducts.get(phase.name) || [];
  const [start, end] = phase.range;
  const pad = phase.name.padEnd(25);
  const status = items.length > (end - start + 1) ? ' ⚠️ OVERFLOW' : '';
  console.log(`  ${pad} ${String(items.length).padStart(4)} items  (range ${start}-${end})${status}`);
}
console.log('─'.repeat(60));
console.log(`  Total: ${updates.length} products assigned\n`);

// 6. Batch UPDATE statements (D1 limit: 50 per batch)
const BATCH_SIZE = 50;
console.log(`Updating sort_order in batches of ${BATCH_SIZE}...`);

for (let i = 0; i < updates.length; i += BATCH_SIZE) {
  const batch = updates.slice(i, i + BATCH_SIZE);
  const statements = batch
    .map((u) => `UPDATE product_catalog SET sort_order = ${u.sort_order} WHERE id = '${u.id}';`)
    .join(' ');

  runWrangler(statements);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(updates.length / BATCH_SIZE);
  process.stdout.write(`  Batch ${batchNum}/${totalBatches} done (${batch.length} updates)\n`);
}

console.log('\n✅ All sort_order values updated!\n');

// 7. Verify — first 20 and last 20 by sort_order
console.log('Verification — First 20 products by sort_order:');
console.log('─'.repeat(70));
const first20 = runWrangler('SELECT name, sort_order, category FROM product_catalog ORDER BY sort_order ASC LIMIT 20');
for (const r of first20) {
  console.log(`  [${String(r.sort_order).padStart(4)}] ${r.name}`);
}

console.log('\nVerification — Last 20 products by sort_order:');
console.log('─'.repeat(70));
const last20 = runWrangler('SELECT name, sort_order, category FROM product_catalog ORDER BY sort_order DESC LIMIT 20');
for (const r of last20.reverse()) {
  console.log(`  [${String(r.sort_order).padStart(4)}] ${r.name}`);
}

console.log('\n=== Done! ===');
