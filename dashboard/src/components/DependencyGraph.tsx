/**
 * DependencyGraph Component
 *
 * Displays PR dependencies in a tree structure with critical path highlighting.
 * Simpler tree view approach - can be upgraded to React Flow later if needed.
 */

import { useState } from 'react';
import { PRData, DependencyGraph as DepGraph } from '../utils/dependencyAnalysis';
import './DependencyGraph.css';

interface DependencyGraphProps {
  prs: PRData[];
  dependencyGraph: DepGraph | null;
  criticalPath: string[];
}

export function DependencyGraph({ prs, dependencyGraph, criticalPath }: DependencyGraphProps) {
  const [expandedPRs, setExpandedPRs] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'critical' | 'roots'>('all');

  if (!dependencyGraph) {
    return (
      <div className="dependency-graph">
        <h2>Dependency Graph</h2>
        <div className="empty-state">No dependency data available</div>
      </div>
    );
  }

  const toggleExpand = (prId: string) => {
    const newExpanded = new Set(expandedPRs);
    if (newExpanded.has(prId)) {
      newExpanded.delete(prId);
    } else {
      newExpanded.add(prId);
    }
    setExpandedPRs(newExpanded);
  };

  const expandAll = () => {
    setExpandedPRs(new Set(prs.map((pr) => pr.pr_id)));
  };

  const collapseAll = () => {
    setExpandedPRs(new Set());
  };

  // Find root PRs (no dependencies)
  const rootPRs = prs.filter((pr) => {
    const deps = dependencyGraph.getDependencies(pr.pr_id);
    return deps.length === 0;
  });

  // Filter PRs based on selection
  const getFilteredPRs = () => {
    switch (filter) {
      case 'critical':
        return prs.filter((pr) => criticalPath.includes(pr.pr_id));
      case 'roots':
        return rootPRs;
      default:
        return prs;
    }
  };

  const filteredPRs = getFilteredPRs();

  // Render a single PR node
  const renderPRNode = (pr: PRData, level: number = 0, visited: Set<string> = new Set()) => {
    // Prevent infinite loops from cycles
    if (visited.has(pr.pr_id)) {
      return (
        <div
          key={`${pr.pr_id}-cycle`}
          className="pr-node cycle"
          style={{ marginLeft: `${level * 20}px` }}
        >
          <span className="cycle-indicator">↻ {pr.pr_id} (circular reference)</span>
        </div>
      );
    }

    const newVisited = new Set(visited);
    newVisited.add(pr.pr_id);

    const deps = dependencyGraph.getDependencies(pr.pr_id);
    const dependents = dependencyGraph.getDependents(pr.pr_id);
    const isExpanded = expandedPRs.has(pr.pr_id);
    const isOnCriticalPath = criticalPath.includes(pr.pr_id);
    const hasChildren = dependents.length > 0;

    return (
      <div key={pr.pr_id} className="pr-node-container">
        <div
          className={`pr-node ${isOnCriticalPath ? 'critical-path' : ''} ${
            hasChildren ? 'has-children' : ''
          }`}
          style={{ marginLeft: `${level * 20}px` }}
        >
          {hasChildren && (
            <button className="expand-btn" onClick={() => toggleExpand(pr.pr_id)}>
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          <span className="pr-id">{pr.pr_id}</span>
          <span className="pr-title">{pr.title}</span>
          {isOnCriticalPath && <span className="critical-badge">Critical Path</span>}
          <span className="pr-meta">
            {deps.length > 0 && (
              <span className="dep-count" title="Dependencies">
                ↓{deps.length}
              </span>
            )}
            {dependents.length > 0 && (
              <span className="dependent-count" title="Dependents">
                ↑{dependents.length}
              </span>
            )}
          </span>
        </div>

        {isExpanded && hasChildren && (
          <div className="pr-children">
            {dependents.map((depId) => {
              const depPR = prs.find((p) => p.pr_id === depId);
              if (!depPR) return null;
              return renderPRNode(depPR, level + 1, newVisited);
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="dependency-graph">
      <div className="graph-header">
        <h2>Dependency Graph</h2>
        <div className="graph-controls">
          <div className="filter-buttons">
            <button
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              All PRs ({prs.length})
            </button>
            <button
              className={filter === 'roots' ? 'active' : ''}
              onClick={() => setFilter('roots')}
            >
              Root PRs ({rootPRs.length})
            </button>
            <button
              className={filter === 'critical' ? 'active' : ''}
              onClick={() => setFilter('critical')}
            >
              Critical Path ({criticalPath.length})
            </button>
          </div>
          <div className="expand-buttons">
            <button onClick={expandAll}>Expand All</button>
            <button onClick={collapseAll}>Collapse All</button>
          </div>
        </div>
      </div>

      <div className="graph-content">
        {filteredPRs.length === 0 ? (
          <div className="empty-state">No PRs match the current filter</div>
        ) : (
          <div className="pr-tree">
            {filteredPRs
              .filter((pr) => filter === 'all' || dependencyGraph.getDependencies(pr.pr_id).length === 0)
              .map((pr) => renderPRNode(pr))}
          </div>
        )}
      </div>

      <div className="graph-legend">
        <div className="legend-item">
          <span className="legend-badge critical-path">Critical Path</span>
          <span className="legend-text">Longest dependency chain</span>
        </div>
        <div className="legend-item">
          <span className="legend-indicator">↓N</span>
          <span className="legend-text">Number of dependencies</span>
        </div>
        <div className="legend-item">
          <span className="legend-indicator">↑N</span>
          <span className="legend-text">Number of dependents</span>
        </div>
      </div>
    </div>
  );
}
