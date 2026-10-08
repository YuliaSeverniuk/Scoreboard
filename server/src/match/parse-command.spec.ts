import { parseCommand } from './parse-command';

describe('parseCommand', () => {
    it('accepts valid commands', () => {
      expect(parseCommand({ type: 'score', team: 'home', delta: 3 })).toEqual({ type: 'score', team: 'home', delta: 3 });
      expect(parseCommand({ type: 'clock.start' })).toEqual({ type: 'clock.start' });
    });

    it('ignores unknown extra fields (tolerant reader)', () => {
      expect(parseCommand({ type: 'horn', addedInV2: true })).toEqual({ type: 'horn' });
    });

    it('rejects garbage', () => {
      expect(parseCommand(null)).toBeNull();
      expect(parseCommand('score')).toBeNull();
      expect(parseCommand({ type: 'score', team: 'referee', delta: 1 })).toBeNull();
      expect(parseCommand({ type: 'score', team: 'home', delta: 100 })).toBeNull();
      expect(parseCommand({ type: 'self-destruct' })).toBeNull();
    });

})