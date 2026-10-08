export const PROTOCOL_VERSION = 1;

export type Team = "home" | "away";

export interface TeamState {
    name: string;
    score: number;
    fouls: number;
}

export interface MatchState {
    home: TeamState;
    away: TeamState;
    period: number;
    clock: {
        remainingMs: number;
        running: boolean;
    };
    horn: boolean;
}

export type Command = 
|{ type: 'score', team: Team, delta: number } 
|{ type:'foul', team: Team, delta: number } 
|{ type: 'clock.start'}
|{ type: 'clock.stop' }
|{ type: 'period.next' } 
|{ type: 'horn' }
|{ type: 'reset' };

export type ServerMessage = 
|{ type: 'hello', protocol: number, seq: number, state: MatchState }
|{ type: 'state', seq: number, state: MatchState }