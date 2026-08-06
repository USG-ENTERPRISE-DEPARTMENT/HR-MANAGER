require('dotenv').config();
const { prisma } = require('./src/helpers/dbQueryHelper');
const { serialize } = require('./src/helpers/controllerHelpers');

(async () => {
  // Q1: does one column name ever carry MORE THAN ONE gl account? (the case my grouping guarded)
  const perName = serialize(await prisma.$queryRaw`
    SELECT pc.name, COUNT(DISTINCT COALESCE(pc.salarycomponent_gl,'(null)')) AS gl_variants,
           GROUP_CONCAT(DISTINCT COALESCE(pc.salarycomponent_gl,'(null)')) AS accounts
    FROM payrollcolumns pc
    WHERE pc.posting_column = 'Yes'
    GROUP BY pc.name
    HAVING COUNT(DISTINCT COALESCE(pc.salarycomponent_gl,'(null)')) > 1`);
  console.log('column NAMES carrying >1 GL account:', perName.length);
  perName.forEach(r => console.log('   ', r.name, '->', r.accounts));

  // Q2: do DIFFERENT column names share the SAME gl account? (the case the user describes)
  const perGl = serialize(await prisma.$queryRaw`
    SELECT COALESCE(pc.salarycomponent_gl,'(null)') AS gl, COUNT(DISTINCT pc.name) AS name_count,
           GROUP_CONCAT(DISTINCT pc.name) AS names
    FROM payrollcolumns pc
    WHERE pc.posting_column = 'Yes'
    GROUP BY COALESCE(pc.salarycomponent_gl,'(null)')
    HAVING COUNT(DISTINCT pc.name) > 1`);
  console.log('\nGL accounts shared by >1 column name:', perGl.length);
  perGl.forEach(r => console.log('   ', r.gl, '->', r.names));

  // Q3: are there duplicate column NAMES at all (distinct rows, same name)?
  const dupeNames = serialize(await prisma.$queryRaw`
    SELECT pc.name, COUNT(*) AS row_count
    FROM payrollcolumns pc WHERE pc.posting_column = 'Yes'
    GROUP BY pc.name HAVING COUNT(*) > 1`);
  console.log('\nduplicate posting-column NAMES (separate rows, same name):', dupeNames.length);
  dupeNames.forEach(r => console.log('   ', r.name, 'x', String(r.row_count)));

  // Q4: currency — could one column span currencies across employees?
  const cur = serialize(await prisma.$queryRaw`
    SELECT COUNT(DISTINCT COALESCE(pe.currency,'(null)')) AS variants,
           GROUP_CONCAT(DISTINCT COALESCE(pe.currency,'(null)')) AS list
    FROM payrollemployees pe`);
  console.log('\ndistinct currencies across payrollemployees:', cur[0]?.variants, '->', cur[0]?.list);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
