/**
 * Returns the 1-indexed draft position (1..numTeams) on the clock for a given
 * overall pick number in a standard snake draft (odd rounds go 1..N, even
 * rounds reverse N..1).
 */
export function getTeamPositionForPick(pickNumber: number, numTeams: number): number {
  if (numTeams <= 0) throw new Error("numTeams must be positive");
  if (pickNumber <= 0) throw new Error("pickNumber must be positive");

  const round = getRoundForPick(pickNumber, numTeams);
  const posInRound = ((pickNumber - 1) % numTeams) + 1;
  return round % 2 === 1 ? posInRound : numTeams - posInRound + 1;
}

export function getRoundForPick(pickNumber: number, numTeams: number): number {
  return Math.ceil(pickNumber / numTeams);
}
