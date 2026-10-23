// A worker represents one task. Additional role assignments remain task metadata.
// Both scene renderers consume this same list; source objects are never changed.
export function oneWorkerPerTask(seats) {
  const seen=new Set(), workers=[];
  for(const seat of seats) {
    const id=seat.taskId||seat.id;
    const key=JSON.stringify([seat.source||'codex',id]);
    if(!id||seen.has(key))continue;
    seen.add(key);workers.push(seat);
  }
  return workers.length===seats.length?seats:workers;
}
