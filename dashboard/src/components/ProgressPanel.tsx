/**
 * ProgressPanel Component
 *
 * Displays phase-based progress bars showing completion status for each project phase.
 */

import { useState } from 'react';
import { PhaseProgress } from '../utils/dependencyAnalysis';
import './ProgressPanel.css';

interface ProgressPanelProps {
  phaseProgress: PhaseProgress[];
}

export function ProgressPanel({ phaseProgress }: ProgressPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="progress-panel">
      <h2 onClick={() => setIsCollapsed(!isCollapsed)} className="collapsible-header">
        <span className={`chevron ${isCollapsed ? 'collapsed' : ''}`}>▼</span>
        Phase Progress
      </h2>

      {!isCollapsed && (
        <div className="phase-list">
        {phaseProgress.length === 0 ? (
          <div className="empty-state">
            No phase data available. Waiting for PR data...
          </div>
        ) : (
          phaseProgress.map((phase) => (
            <div key={phase.phaseName} className="phase-item">
              <div className="phase-header">
                <div className="phase-name">{phase.phaseName}</div>
                <div className="phase-stats">
                  <span className="stat completed">{phase.completed} completed</span>
                  <span className="stat in-progress">{phase.inProgress} in progress</span>
                  <span className="stat blocked">{phase.blocked} blocked</span>
                  <span className="stat total">{phase.total} total</span>
                </div>
              </div>

              <div className="progress-bar-container">
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${phase.percent}%` }}
                  >
                    {phase.percent > 10 && (
                      <span className="progress-text">{phase.percent.toFixed(0)}%</span>
                    )}
                  </div>
                </div>
                {phase.percent <= 10 && phase.percent > 0 && (
                  <span className="progress-text-outside">{phase.percent.toFixed(0)}%</span>
                )}
              </div>

              <div className="phase-status-icons">
                {/* Status indicators */}
                {phase.completed === phase.total && (
                  <span className="status-badge complete">✓ Complete</span>
                )}
                {phase.inProgress > 0 && (
                  <span className="status-badge active">⚙ Active</span>
                )}
                {phase.blocked > 0 && (
                  <span className="status-badge blocked">⚠ {phase.blocked} Blocked</span>
                )}
                {phase.completed === 0 && phase.inProgress === 0 && (
                  <span className="status-badge pending">○ Not Started</span>
                )}
              </div>
            </div>
          ))
        )}
        </div>
      )}
    </div>
  );
}
