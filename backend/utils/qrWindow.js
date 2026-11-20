function qrWindow(schedule) {
  const date = new Date(new Date(schedule.date).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = new Date(`${date}T${schedule.startTime}:00+07:00`);
  let end = new Date(`${date}T${schedule.endTime}:00+07:00`);
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return {
    opensAt: new Date(end.getTime() - 30 * 60 * 1000),
    closesAt: new Date(end.getTime() + 30 * 60 * 1000)
  };
}

module.exports = { qrWindow };
