require('dotenv').config({ path: '.env' });
const { prisma } = require('../src/helpers/dbQueryHelper');

async function main() {
  const employee = await prisma.employee.findFirst({ select: { id: true, departmentId: true, jobTitleId: true } });
  if (!employee) throw new Error('No employee is available for the transfer model smoke test');
  const marker = `TRF-SMOKE-${Date.now()}`;
  const currentValues = {
    departmentId: employee.departmentId == null ? null : String(employee.departmentId),
    jobTitleId: employee.jobTitleId == null ? null : String(employee.jobTitleId),
  };
  const proposedValues = { ...currentValues };
  try {
    await prisma.$transaction(async tx => {
      const transfer = await tx.employeetransfers.create({ data: {
        transfer_number: marker,
        employee: employee.id,
        transfer_type: 'Smoke Test',
        effective_date: new Date(),
        current_department: employee.departmentId,
        proposed_department: employee.departmentId,
        current_job_title: employee.jobTitleId,
        proposed_job_title: employee.jobTitleId,
        current_values: JSON.stringify(currentValues),
        proposed_values: JSON.stringify(proposedValues),
      } });
      await tx.employeetransferstages.create({ data: {
        transfer_id: transfer.id,
        stage_order: 0,
        stage_name: 'Smoke Approval',
        approver_type: 'role',
        approver_id: '0',
        approver_label: 'Smoke Role',
      } });
      const loaded = await tx.employeetransfers.findUnique({ where: { id: transfer.id } });
      if (!loaded || loaded.transfer_number !== marker) throw new Error('Transfer could not be read back');
      if (loaded.current_values !== JSON.stringify(currentValues)
        || loaded.proposed_values !== JSON.stringify(proposedValues)) {
        throw new Error('Configured transfer-field snapshots could not be read back');
      }
      throw new Error('ROLLBACK_SMOKE');
    });
  } catch (error) {
    if (error.message !== 'ROLLBACK_SMOKE') throw error;
  }
  const residue = await prisma.employeetransfers.count({ where: { transfer_number: marker } });
  if (residue) throw new Error('Smoke transfer was not rolled back');
  console.log('Employee transfer Prisma create/read/stage/rollback smoke test passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
