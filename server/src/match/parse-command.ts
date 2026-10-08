import { Command, Team } from "./protocol";

const TEAMS: readonly Team[] = ["home", "away"];
const SIMPLE_COMMANDS = ["clock.start", "clock.stop", "period.next", "horn", "reset"] as const;

export function parseCommand(row: unknown): Command | null {
    if (typeof row !== 'object' || row === null) return null;
    const msg = row as Record<string, unknown>;

    if (msg.type === 'score' || msg.type === 'foul') {
        const team = msg.team as Team;
        const delta = msg.delta;

        if (!TEAMS.includes(team)) return null;
        if (typeof delta !== 'number' || !Number.isInteger(delta) || Math.abs(delta) > 1) return null;
        return { type: msg.type, team, delta };
    }

    const simple = SIMPLE_COMMANDS.find((type) => type === msg.type);
    return simple ? { type: simple } : null;
}