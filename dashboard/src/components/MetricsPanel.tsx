/**
 * MetricsPanel Component
 *
 * Displays aggregate metrics including completion percentage,
 * time estimates, velocity, and complexity distribution.
 */

import { ProgressMetrics } from '../hooks/useProgressMetrics';
import './MetricsPanel.css';

interface MetricsPanelProps {
  metrics: ProgressMetrics;
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  // Format date
  const formatDate = (date: Date | null): string => {
    if (!date) return 'N/A';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Format hours
  const formatHours = (hours: number): string => {
    if (hours < 1) {
      return `${Math.round(hours * 60)}m`;
    } else if (hours < 24) {
      return `${hours.toFixed(1)}h`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.round(hours % 24);
      return `${days}d ${remainingHours}h`;
    }
  };

  return (
    <div className="metrics-panel">
      <h2>Project Metrics</h2>

      <div className="metrics-grid">
        {/* Completion */}
        <div className="metric-card">
          <div className="metric-label">Completion</div>
          <div className="metric-value">{metrics.completionPercent.toFixed(1)}%</div>
          <div className="metric-detail">
            {metrics.completed} of {metrics.total} PRs
          </div>
        </div>

        {/* In Progress */}
        <div className="metric-card">
          <div className="metric-label">In Progress</div>
          <div className="metric-value">{metrics.inProgress}</div>
          <div className="metric-detail">actively working</div>
        </div>

        {/* Ready */}
        <div className="metric-card ready">
          <div className="metric-label">Ready to Start</div>
          <div className="metric-value">{metrics.ready}</div>
          <div className="metric-detail">dependencies met</div>
        </div>

        {/* Blocked */}
        <div className="metric-card blocked">
          <div className="metric-label">Blocked</div>
          <div className="metric-value">{metrics.blocked}</div>
          <div className="metric-detail">waiting on deps</div>
        </div>

        {/* Estimated Completion */}
        <div className="metric-card estimate">
          <div className="metric-label">Est. Completion</div>
          <div className="metric-value-sm">
            {formatDate(metrics.estimatedCompletionDate)}
          </div>
          <div className="metric-detail">
            {formatHours(metrics.estimatedHoursRemaining)} remaining
          </div>
        </div>

        {/* Critical Path */}
        <div className="metric-card critical">
          <div className="metric-label">Critical Path</div>
          <div className="metric-value-sm">
            {formatHours(metrics.criticalPathHours)}
          </div>
          <div className="metric-detail">
            {metrics.criticalPath.length} PRs in sequence
          </div>
        </div>

        {/* Parallelization */}
        <div className="metric-card">
          <div className="metric-label">Parallelization</div>
          <div className="metric-value">{metrics.parallelizationFactor.toFixed(1)}x</div>
          <div className="metric-detail">potential speedup</div>
        </div>

        {/* Issues */}
        <div className="metric-card broken">
          <div className="metric-label">Broken</div>
          <div className="metric-value">{metrics.broken}</div>
          <div className="metric-detail">needs fixing</div>
        </div>
      </div>

      {/* Warnings/Alerts */}
      {metrics.cyclesDetected.length > 0 && (
        <div className="metrics-alert error">
          <strong>⚠️ Circular Dependencies Detected!</strong>
          <div className="cycle-list">
            {metrics.cyclesDetected.map((cycle, idx) => (
              <div key={idx} className="cycle-item">
                Cycle {idx + 1}: {cycle.join(' → ')}
              </div>
            ))}
          </div>
        </div>
      )}

      {metrics.blocked > metrics.total * 0.3 && (
        <div className="metrics-alert warning">
          <strong>⚠️ High Blocking Rate</strong>
          <p>
            {metrics.blocked} PRs ({((metrics.blocked / metrics.total) * 100).toFixed(0)}%) are
            blocked. Consider parallelizing work or resolving blockers.
          </p>
        </div>
      )}
    </div>
  );
}
