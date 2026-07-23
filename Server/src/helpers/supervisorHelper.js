const { prisma } = require('./dbQueryHelper');

// When an employee's supervisor changes, move any work still awaiting the OLD supervisor's
// action over to the NEW supervisor so nothing stays stuck with the previous manager.
//
// Most supervisor queues in the app resolve the supervisor LIVE from employee.supervisorId at
// query time (leave central approval, training nomination approval, attendance subordinates),
// so they re-route automatically and need no action here. The only flows that persist a
// supervisor *snapshot* on the request must be re-pointed explicitly — this helper is the single
// authoritative place to do that. Extend it here if any future flow stores its own supervisor.
//
// Currently handled:
//   • Performance reviews still awaiting supervisor action (status 'Not Started' / 'Self
//     Assessment'). Reviews the supervisor has already actioned (Supervisor Review onward) and
//     completed reviews keep their actual reviewer for the historical record.
async function reassignPendingSupervisorWork(employeeId, newSupervisorId) {
  const empId = employeeId != null ? BigInt(employeeId) : null;
  if (empId == null) return;
  const newSup = newSupervisorId != null ? BigInt(newSupervisorId) : null;

  try {
    await prisma.$executeRaw`
      UPDATE performance_review SET supervisor = ${newSup}, updated_at = NOW()
       WHERE employee = ${empId} AND status IN ('Not Started', 'Self Assessment')`;
  } catch { /* non-critical — never block the employee update */ }
}

module.exports = { reassignPendingSupervisorWork };
