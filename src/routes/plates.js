const express = require('express');
const router = express.Router();
const { getDb, normalizePlate } = require('../db/init');

router.get('/:plateNumber', async (req, res) => {
  const { plateNumber } = req.params;
  const normalized = normalizePlate(plateNumber);
  const db = getDb();

  const vehicleResult = await db.exec(
    `SELECT id, plate_number, state, plate_type, make, model, year, color, reg_expiration
     FROM vehicles WHERE normalized_plate = ?`,
    [normalized]
  );

  if (vehicleResult.length === 0 || vehicleResult[0].values.length === 0) {
    return res.json({
      plate: plateNumber,
      normalized: normalized,
      found: false,
      tickets: 0,
      totalOwed: 0,
      status: 'NO_RECORD',
      message: 'No tickets found for this plate.',
    });
  }

  const [vehicleId, originalPlate, state, plateType, make, model, year, color, regExp] = vehicleResult[0].values[0];

  const summaryResult = await db.exec(`
    SELECT
      COUNT(*) as ticket_count,
      SUM(CASE WHEN status NOT IN ('PAID', 'DISMISSED') THEN fine_amount + late_fee - payment_amount ELSE 0 END) as total_owed,
      SUM(CASE WHEN status = 'UNPAID' THEN 1 ELSE 0 END) as unpaid_count,
      SUM(CASE WHEN status = 'JUDGMENT' THEN 1 ELSE 0 END) as judgment_count,
      SUM(CASE WHEN dmv_reported = 1 THEN 1 ELSE 0 END) as dmv_hold_count,
      MAX(issue_date) as most_recent_ticket
    FROM tickets
    WHERE vehicle_id = ?
  `, [vehicleId]);

  const [ticketCount, totalOwed, unpaidCount, judgmentCount, dmvHoldCount, mostRecentTicket] = summaryResult[0].values[0];

  const openCount = (unpaidCount || 0) + (judgmentCount || 0);
  let status = 'CLEAR';
  const flags = [];

  if (openCount >= 3) {
    status = 'BOOT_ELIGIBLE';
    flags.push('BOOT_LIST');
  } else if (openCount > 0) {
    status = 'OUTSTANDING';
  }

  if (totalOwed >= 200) flags.push('HIGH_BALANCE');
  if (totalOwed >= 500) { flags.push('TOW_LIST'); status = 'TOW_ELIGIBLE'; }
  if (dmvHoldCount >= 3) flags.push('DMV_HOLD');
  if (judgmentCount > 0) flags.push('JUDGMENTS_OUTSTANDING');

  res.json({
    plate: originalPlate,
    normalized: normalized,
    state: state,
    plateType: plateType,
    vehicle: { make, model, year, color, registrationExpires: regExp },
    found: true,
    tickets: ticketCount,
    unpaidTickets: unpaidCount || 0,
    judgmentTickets: judgmentCount || 0,
    totalOwed: parseFloat(totalOwed?.toFixed(2) || 0),
    formattedOwed: `$${(totalOwed || 0).toFixed(2)}`,
    status: status,
    flags: flags,
    mostRecentTicket: mostRecentTicket,
    queriedAt: new Date().toISOString(),
  });
});

router.get('/:plateNumber/tickets', async (req, res) => {
  const { plateNumber } = req.params;
  const normalized = normalizePlate(plateNumber);
  const db = getDb();

  const vehicleResult = await db.exec(
    `SELECT id, plate_number, state, plate_type, make, model, year, color, reg_expiration
     FROM vehicles WHERE normalized_plate = ?`,
    [normalized]
  );

  if (vehicleResult.length === 0 || vehicleResult[0].values.length === 0) {
    return res.json({ plate: plateNumber, found: false, tickets: [] });
  }

  const [vehicleId, originalPlate, state, plateType, make, model, year, color, regExp] = vehicleResult[0].values[0];

  const ticketsResult = await db.exec(`
    SELECT
      t.ticket_number, t.violation_code, t.violation_desc,
      t.issue_date, t.issue_time, t.due_date,
      t.fine_amount, t.late_fee, t.payment_amount,
      t.status, t.location, t.officer_badge,
      t.meter_number, t.judgment_date, t.dmv_reported,
      m.name as municipality, m.code as municipality_code, m.county as county
    FROM tickets t
    JOIN municipalities m ON t.municipality_id = m.id
    WHERE t.vehicle_id = ?
    ORDER BY t.issue_date DESC
  `, [vehicleId]);

  let tickets = [];
  if (ticketsResult.length > 0 && ticketsResult[0].values.length > 0) {
    const columns = ticketsResult[0].columns;
    tickets = ticketsResult[0].values.map(row => {
      const ticket = {};
      columns.forEach((col, i) => { ticket[col] = row[i]; });
      if (ticket.status === 'PAID' || ticket.status === 'DISMISSED') {
        ticket.balance_due = 0;
      } else {
        ticket.balance_due = Math.max(0, (ticket.fine_amount || 0) + (ticket.late_fee || 0) - (ticket.payment_amount || 0));
      }
      ticket.formatted_balance = `$${ticket.balance_due.toFixed(2)}`;
      ticket.dmv_reported = ticket.dmv_reported === 1;
      return ticket;
    });
  }

  const activeTickets = tickets.filter(t => t.status !== 'DISMISSED');
  const totalFines = activeTickets.reduce((sum, t) => sum + (t.fine_amount || 0), 0);
  const totalLateFees = activeTickets.reduce((sum, t) => sum + (t.late_fee || 0), 0);
  const totalPayments = activeTickets.reduce((sum, t) => sum + (t.payment_amount || 0), 0);
  const totalOwed = activeTickets.reduce((sum, t) => sum + t.balance_due, 0);

  res.json({
    plate: originalPlate,
    state: state,
    vehicle: { make, model, year, color, registrationExpires: regExp },
    found: true,
    summary: {
      totalTickets: tickets.length,
      totalFines: parseFloat(totalFines.toFixed(2)),
      totalLateFees: parseFloat(totalLateFees.toFixed(2)),
      totalPayments: parseFloat(totalPayments.toFixed(2)),
      totalOwed: parseFloat(totalOwed.toFixed(2)),
      formattedOwed: `$${totalOwed.toFixed(2)}`,
    },
    tickets: tickets,
    queriedAt: new Date().toISOString(),
  });
});

module.exports = router;
