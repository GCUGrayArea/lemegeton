/**
 * State Machine Tests
 *
 * Comprehensive test suite for the state machine implementation.
 */

import { StateMachine, IGitCommitter, IStateEventEmitter, CommitMetadata, StateTransitionEvent } from '../src/core/stateMachine';
import { isValidTransition, requiresCommit, getAvailableTransitions } from '../src/core/transitions';
import { isHotState, isColdState } from '../src/core/states';
import { PRState, HotState, ColdState } from '../src/types/pr';

describe('State Guards', () => {
  describe('isHotState', () => {
    it('should identify hot states correctly', () => {
      expect(isHotState('investigating')).toBe(true);
      expect(isHotState('planning')).toBe(true);
      expect(isHotState('in-progress')).toBe(true);
      expect(isHotState('under-review')).toBe(true);
    });

    it('should return false for cold states', () => {
      expect(isHotState('new')).toBe(false);
      expect(isHotState('ready')).toBe(false);
      expect(isHotState('completed')).toBe(false);
    });

    it('should return false for invalid states', () => {
      expect(isHotState('invalid')).toBe(false);
      expect(isHotState('')).toBe(false);
    });
  });

  describe('isColdState', () => {
    it('should identify cold states correctly', () => {
      expect(isColdState('new')).toBe(true);
      expect(isColdState('ready')).toBe(true);
      expect(isColdState('blocked')).toBe(true);
      expect(isColdState('planned')).toBe(true);
      expect(isColdState('completed')).toBe(true);
      expect(isColdState('approved')).toBe(true);
      expect(isColdState('broken')).toBe(true);
    });

    it('should return false for hot states', () => {
      expect(isColdState('investigating')).toBe(false);
      expect(isColdState('in-progress')).toBe(false);
    });
  });
});

describe('Transition Validation', () => {
  describe('Cold → Cold transitions', () => {
    it('should allow new → ready', () => {
      expect(isValidTransition('new', 'ready')).toBe(true);
      expect(requiresCommit('new', 'ready')).toBe(true);
    });

    it('should allow new → blocked', () => {
      expect(isValidTransition('new', 'blocked')).toBe(true);
      expect(requiresCommit('new', 'blocked')).toBe(true);
    });

    it('should allow blocked → ready', () => {
      expect(isValidTransition('blocked', 'ready')).toBe(true);
    });

    it('should allow completed → approved', () => {
      expect(isValidTransition('completed', 'approved')).toBe(true);
      expect(requiresCommit('completed', 'approved')).toBe(true);
    });

    it('should allow completed → broken', () => {
      expect(isValidTransition('completed', 'broken')).toBe(true);
    });

    it('should allow approved → broken (regression)', () => {
      expect(isValidTransition('approved', 'broken')).toBe(true);
      expect(requiresCommit('approved', 'broken')).toBe(true);
    });

    it('should allow broken → planned', () => {
      expect(isValidTransition('broken', 'planned')).toBe(true);
    });
  });

  describe('Hot → Hot transitions', () => {
    it('should allow investigating → planning', () => {
      expect(isValidTransition('investigating', 'planning')).toBe(true);
      expect(requiresCommit('investigating', 'planning')).toBe(false);
    });

    it('should allow planning → in-progress', () => {
      expect(isValidTransition('planning', 'in-progress')).toBe(true);
      expect(requiresCommit('planning', 'in-progress')).toBe(false);
    });

    it('should allow in-progress → under-review', () => {
      expect(isValidTransition('in-progress', 'under-review')).toBe(true);
      expect(requiresCommit('in-progress', 'under-review')).toBe(false);
    });
  });

  describe('Cold → Hot transitions', () => {
    it('should allow ready → investigating', () => {
      expect(isValidTransition('ready', 'investigating')).toBe(true);
      expect(requiresCommit('ready', 'investigating')).toBe(false);
    });

    it('should allow ready → in-progress', () => {
      expect(isValidTransition('ready', 'in-progress')).toBe(true);
      expect(requiresCommit('ready', 'in-progress')).toBe(false);
    });

    it('should allow planned → in-progress', () => {
      expect(isValidTransition('planned', 'in-progress')).toBe(true);
    });

    it('should allow completed → under-review', () => {
      expect(isValidTransition('completed', 'under-review')).toBe(true);
    });

    it('should allow broken → investigating', () => {
      expect(isValidTransition('broken', 'investigating')).toBe(true);
    });
  });

  describe('Hot → Cold transitions', () => {
    it('should allow investigating → planned', () => {
      expect(isValidTransition('investigating', 'planned')).toBe(true);
      expect(requiresCommit('investigating', 'planned')).toBe(true);
    });

    it('should allow planning → planned', () => {
      expect(isValidTransition('planning', 'planned')).toBe(true);
      expect(requiresCommit('planning', 'planned')).toBe(true);
    });

    it('should allow in-progress → completed', () => {
      expect(isValidTransition('in-progress', 'completed')).toBe(true);
      expect(requiresCommit('in-progress', 'completed')).toBe(true);
    });

    it('should allow under-review → approved', () => {
      expect(isValidTransition('under-review', 'approved')).toBe(true);
      expect(requiresCommit('under-review', 'approved')).toBe(true);
    });

    it('should allow under-review → broken', () => {
      expect(isValidTransition('under-review', 'broken')).toBe(true);
    });
  });

  describe('Invalid transitions', () => {
    it('should reject backwards transitions', () => {
      expect(isValidTransition('completed', 'in-progress')).toBe(false);
      expect(isValidTransition('approved', 'completed')).toBe(false);
      expect(isValidTransition('planned', 'new')).toBe(false);
    });

    it('should reject skipping states', () => {
      expect(isValidTransition('new', 'completed')).toBe(false);
      expect(isValidTransition('investigating', 'approved')).toBe(false);
    });

    it('should reject illogical transitions', () => {
      expect(isValidTransition('new', 'approved')).toBe(false);
      expect(isValidTransition('blocked', 'completed')).toBe(false);
    });
  });

  describe('Same-state transitions', () => {
    it('should allow staying in same state (idempotent)', () => {
      expect(isValidTransition('ready', 'ready')).toBe(true);
      expect(isValidTransition('in-progress', 'in-progress')).toBe(true);
      expect(requiresCommit('ready', 'ready')).toBe(false);
    });
  });

  describe('getAvailableTransitions', () => {
    it('should return correct transitions from ready', () => {
      const transitions = getAvailableTransitions('ready');
      expect(transitions).toContain('ready');
      expect(transitions).toContain('blocked');
      expect(transitions).toContain('investigating');
      expect(transitions).toContain('in-progress');
    });

    it('should return correct transitions from completed', () => {
      const transitions = getAvailableTransitions('completed');
      expect(transitions).toContain('completed');
      expect(transitions).toContain('approved');
      expect(transitions).toContain('broken');
      expect(transitions).toContain('under-review');
    });
  });
});

describe('StateMachine', () => {
  let mockGitCommitter: jest.Mocked<IGitCommitter>;
  let mockEventEmitter: jest.Mocked<IStateEventEmitter>;
  let stateMachine: StateMachine;
  let mockPRState: PRState;

  beforeEach(() => {
    mockGitCommitter = {
      commit: jest.fn().mockResolvedValue(undefined)
    };

    mockEventEmitter = {
      emit: jest.fn()
    };

    stateMachine = new StateMachine(mockGitCommitter, mockEventEmitter);

    mockPRState = {
      pr_id: 'PR-001',
      cold_state: 'ready',
      hot_state: undefined,
      agent_id: undefined,
      dependencies: [],
      files_locked: [],
      last_transition: new Date().toISOString()
    };
  });

  describe('transition', () => {
    it('should successfully transition from cold to hot state', async () => {
      const result = await stateMachine.transition(
        'PR-001',
        mockPRState,
        'in-progress',
        'agent-1',
        'Starting implementation'
      );

      expect(result.success).toBe(true);
      expect(result.new_state).toBe('in-progress');
      expect(result.committed).toBe(false);
      expect(mockGitCommitter.commit).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'state_transition',
        expect.objectContaining({
          pr_id: 'PR-001',
          from: 'ready',
          to: 'in-progress',
          committed: false
        })
      );
    });

    it('should trigger git commit for hot to cold transition', async () => {
      mockPRState.hot_state = 'in-progress';

      const result = await stateMachine.transition(
        'PR-001',
        mockPRState,
        'completed',
        'agent-1',
        'Implementation finished'
      );

      expect(result.success).toBe(true);
      expect(result.new_state).toBe('completed');
      expect(result.committed).toBe(true);
      expect(mockGitCommitter.commit).toHaveBeenCalledWith(
        expect.stringContaining('in-progress → completed'),
        expect.objectContaining({
          pr_id: 'PR-001',
          from_state: 'in-progress',
          to_state: 'completed'
        })
      );
    });

    it('should trigger git commit for cold to cold transition', async () => {
      const result = await stateMachine.transition(
        'PR-001',
        mockPRState,
        'blocked'
      );

      expect(result.success).toBe(true);
      expect(result.committed).toBe(true);
      expect(mockGitCommitter.commit).toHaveBeenCalled();
    });

    it('should reject invalid transitions', async () => {
      mockPRState.cold_state = 'new';

      const result = await stateMachine.transition(
        'PR-001',
        mockPRState,
        'completed'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.new_state).toBe('new');
      expect(mockGitCommitter.commit).not.toHaveBeenCalled();
    });

    it('should handle git commit failures gracefully', async () => {
      mockGitCommitter.commit.mockRejectedValue(new Error('Git error'));

      const result = await stateMachine.transition(
        'PR-001',
        mockPRState,
        'blocked'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Git commit failed');
      expect(result.new_state).toBe('ready');
    });

    it('should be idempotent for same-state transitions', async () => {
      const result = await stateMachine.transition(
        'PR-001',
        mockPRState,
        'ready'
      );

      expect(result.success).toBe(true);
      expect(result.new_state).toBe('ready');
      expect(result.committed).toBe(false);
      expect(mockGitCommitter.commit).not.toHaveBeenCalled();
    });

    it('should work without git committer or event emitter', async () => {
      const basicStateMachine = new StateMachine();

      const result = await basicStateMachine.transition(
        'PR-001',
        mockPRState,
        'investigating'
      );

      expect(result.success).toBe(true);
      expect(result.new_state).toBe('investigating');
    });

    it('should handle event emission failures gracefully', async () => {
      mockEventEmitter.emit.mockImplementation(() => {
        throw new Error('Event error');
      });

      const result = await stateMachine.transition(
        'PR-001',
        mockPRState,
        'investigating'
      );

      expect(result.success).toBe(true);
      expect(result.new_state).toBe('investigating');
    });
  });

  describe('helper methods', () => {
    it('validateTransition should return detailed validation', () => {
      const valid = stateMachine.validateTransition('ready', 'in-progress');
      expect(valid.valid).toBe(true);
      expect(valid.rule).toBeDefined();

      const invalid = stateMachine.validateTransition('new', 'approved');
      expect(invalid.valid).toBe(false);
      expect(invalid.error).toBeDefined();
    });

    it('isValidTransition should check validity', () => {
      expect(stateMachine.isValidTransition('ready', 'investigating')).toBe(true);
      expect(stateMachine.isValidTransition('new', 'completed')).toBe(false);
    });

    it('getAvailableTransitions should return valid targets', () => {
      const transitions = stateMachine.getAvailableTransitions('ready');
      expect(transitions.length).toBeGreaterThan(0);
      expect(transitions).toContain('investigating');
    });

    it('requiresCommit should indicate commit necessity', () => {
      expect(stateMachine.requiresCommit('in-progress', 'completed')).toBe(true);
      expect(stateMachine.requiresCommit('ready', 'investigating')).toBe(false);
    });
  });

  describe('approved → broken transition (business logic note)', () => {
    it('should allow approved → broken structurally', async () => {
      mockPRState.cold_state = 'approved';

      const result = await stateMachine.transition(
        'PR-001',
        mockPRState,
        'broken',
        'qc-agent',
        'Regression detected'
      );

      expect(result.success).toBe(true);
      expect(result.new_state).toBe('broken');
      expect(result.committed).toBe(true);
    });

    it('should trigger git commit for approved → broken', async () => {
      mockPRState.cold_state = 'approved';

      await stateMachine.transition(
        'PR-001',
        mockPRState,
        'broken'
      );

      expect(mockGitCommitter.commit).toHaveBeenCalledWith(
        expect.stringContaining('approved → broken'),
        expect.any(Object)
      );
    });
  });
});
