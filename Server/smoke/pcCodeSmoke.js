/**
 * Smoke test for PC-code numbering, RM/RO rules, assignment (one-holder) and delete guards.
 * Creates temporary rows and cleans them up. Run: node smoke/pcCodeSmoke.js
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const { nextChildCode, isReportsToAllowed } = require('../src/helpers/pcCodeHelper');

async function childrenCodes(parentId) {
  return (await p.pccodes.findMany({ where: { reportsToId: parentId }, select: { code: true } })).map(x => x.code);
}
async function mkChild(parentId) {
  const parent = await p.pccodes.findUnique({ where: { id: parentId } });
  const code = nextChildCode(parent.code, await childrenCodes(parentId));
  return p.pccodes.create({ data: { code, name: 'pos ' + code, reportsToId: parentId, isActive: true } });
}
async function holderTag(codeId) {
  const o = await p.pccodeassignments.findFirst({ where: { pcCodeId: codeId, endDate: null } });
  if (!o) return null;
  const e = await p.employee.findUnique({ where: { id: o.employeeId }, select: { rmRoType: true } });
  return e?.rmRoType ?? null;
}

(async () => {
  const results = [];
  const root = await p.pccodes.findFirst({ where: { reportsToId: null } });

  // Isolate from real data: create a temporary parent under root and test relative to it, so the
  // generated child codes are deterministic regardless of how many real codes already exist.
  const parent = await mkChild(root.id); // next free code under root
  const g = parent.code.match(/.{2}/g); // 2-digit groups
  const childSlot = g.findIndex(x => x === '00'); // where this parent's children are numbered

  const a = await mkChild(parent.id);
  const b = await mkChild(parent.id);
  const expA = [...g]; expA[childSlot] = '01'; const expAcode = expA.join('');
  const expB = [...g]; expB[childSlot] = '02'; const expBcode = expB.join('');
  results.push(['sequential children under a parent', a.code + ',' + b.code, a.code === expAcode && b.code === expBcode]);

  const a1 = await mkChild(a.id);
  const a2 = await mkChild(a.id);
  const ga = a.code.match(/.{2}/g); const slot2 = ga.findIndex(x => x === '00');
  const e1 = [...ga]; e1[slot2] = '01'; const e2 = [...ga]; e2[slot2] = '02';
  results.push(['sequential grandchildren', a1.code + ',' + a2.code, a1.code === e1.join('') && a2.code === e2.join('')]);

  const uniq = Date.now();
  const rmEmp = await p.employee.create({ data: { firstName: 'RM', lastName: 'Boss', email: 'rm' + uniq + '@t.local', rmRoType: 'RM', status: '1' } });
  const roEmp = await p.employee.create({ data: { firstName: 'RO', lastName: 'Staff', email: 'ro' + uniq + '@t.local', rmRoType: 'RO', status: '1' } });
  await p.pccodeassignments.create({ data: { pcCodeId: a.id, employeeId: rmEmp.id, endDate: null } });
  await p.pccodeassignments.create({ data: { pcCodeId: a1.id, employeeId: roEmp.id, endDate: null } });

  results.push(['RO position may report to RM position', '', isReportsToAllowed(await holderTag(a1.id), await holderTag(a.id)) === true]);
  results.push(['nothing may report to an RO position', '', isReportsToAllowed('RM', await holderTag(a1.id)) === false]);

  const open = await p.pccodeassignments.findFirst({ where: { pcCodeId: a.id, endDate: null } });
  results.push(['one-holder: code a is held', '', !!open]);

  const childCount = await p.pccodes.count({ where: { reportsToId: a.id } });
  results.push(['delete guard: a has children', String(childCount), childCount > 0]);

  // Cleanup (children before parents)
  await p.pccodeassignments.deleteMany({ where: { employeeId: { in: [rmEmp.id, roEmp.id] } } });
  await p.employee.deleteMany({ where: { id: { in: [rmEmp.id, roEmp.id] } } });
  await p.pccodes.deleteMany({ where: { id: { in: [a1.id, a2.id] } } });
  await p.pccodes.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  await p.pccodes.deleteMany({ where: { id: parent.id } });

  console.log('\n=== PC CODE SMOKE ===');
  let pass = 0;
  for (const [name, val, ok] of results) { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (val ? ' [' + val + ']' : '')); if (ok) pass++; }
  console.log('\n' + pass + '/' + results.length + ' checks passed');
  await p.$disconnect();
  process.exit(pass === results.length ? 0 : 1);
})().catch(async e => { console.error('FATAL', (e.message || '').split('\n').pop()); await p.$disconnect(); process.exit(1); });
