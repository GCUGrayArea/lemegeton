/**
 * DependencyGraphFlow Component
 *
 * Flowchart-style dependency visualization using React Flow.
 * Shows PRs as nodes and dependencies as edges with automatic layout.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Panel,
  MarkerType,
} from 'reactflow';
import dagre from 'dagre';
import { PRData, DependencyGraph as DepGraph } from '../utils/dependencyAnalysis';
import 'reactflow/dist/style.css';
import './DependencyGraphFlow.css';

interface DependencyGraphFlowProps {
  prs: PRData[];
  dependencyGraph: DepGraph | null;
  criticalPath: string[];
}

// Node dimensions for layout algorithm
const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;

// Calculate automatic layout using dagre
const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction = 'TB' // TB = top to bottom, LR = left to right
) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 80, ranksep: 120 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

// Inner component that uses React Flow hooks
function DependencyGraphFlowInner({
  prs,
  dependencyGraph,
  criticalPath,
}: DependencyGraphFlowProps) {
  const reactFlowInstance = useReactFlow();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>('TB');
  const [filter, setFilter] = useState<'all' | 'critical' | 'roots'>('all');

  // Build nodes and edges from PR data
  const { initialNodes, initialEdges } = useMemo(() => {
    console.log('DependencyGraphFlow - PRs:', prs?.length, 'Graph:', !!dependencyGraph);
    if (!dependencyGraph || !prs || prs.length === 0) {
      console.log('DependencyGraphFlow - returning empty (no data)');
      return { initialNodes: [], initialEdges: [] };
    }

    // Filter PRs based on selection
    let filteredPRs = prs;
    if (filter === 'critical') {
      filteredPRs = prs.filter((pr) => criticalPath.includes(pr.pr_id));
    } else if (filter === 'roots') {
      filteredPRs = prs.filter(
        (pr) => !pr.dependencies || pr.dependencies.length === 0
      );
    }

    console.log('DependencyGraphFlow - Filtered PRs:', filteredPRs.length, 'Filter:', filter);

    // Create nodes
    const nodes: Node[] = filteredPRs.map((pr) => {
      const isOnCriticalPath = criticalPath.includes(pr.pr_id);
      const dependencies = pr.dependencies || [];
      const dependents = dependencyGraph.getDependents(pr.pr_id);

      // Determine node color based on state
      let nodeColor = '#2a2a2a'; // default
      let borderColor = '#444';

      if (pr.cold_state === 'completed' || pr.cold_state === 'approved') {
        nodeColor = '#1b5e20';
        borderColor = '#4caf50';
      } else if (pr.cold_state === 'broken') {
        nodeColor = '#b71c1c';
        borderColor = '#f44336';
      } else if (pr.cold_state === 'in-progress') {
        nodeColor = '#0d47a1';
        borderColor = '#2196f3';
      }

      if (isOnCriticalPath) {
        borderColor = '#ff9800';
      }

      return {
        id: pr.pr_id,
        type: 'default',
        data: {
          label: (
            <div className="node-content">
              <div className="node-id">{pr.pr_id}</div>
              <div className="node-title">{pr.title}</div>
              <div className="node-meta">
                {dependencies.length > 0 && (
                  <span className="node-deps" title="Dependencies">
                    ↓{dependencies.length}
                  </span>
                )}
                {dependents.length > 0 && (
                  <span className="node-dependents" title="Dependents">
                    ↑{dependents.length}
                  </span>
                )}
              </div>
            </div>
          ),
        },
        position: { x: 0, y: 0 }, // Will be set by layout algorithm
        style: {
          background: nodeColor,
          border: `2px solid ${borderColor}`,
          borderRadius: '8px',
          padding: '10px',
          width: NODE_WIDTH,
          color: '#fff',
          fontSize: '12px',
        },
      };
    });

    // Create edges (dependencies → dependents)
    const edges: Edge[] = [];
    const prIdSet = new Set(filteredPRs.map((pr) => pr.pr_id));

    filteredPRs.forEach((pr) => {
      const dependencies = pr.dependencies || [];
      dependencies.forEach((depId) => {
        // Only create edge if both nodes exist in filtered set
        if (prIdSet.has(depId)) {
          const isOnCriticalPath =
            criticalPath.includes(pr.pr_id) && criticalPath.includes(depId);

          edges.push({
            id: `${depId}-${pr.pr_id}`,
            source: depId,
            target: pr.pr_id,
            type: 'smoothstep',
            animated: isOnCriticalPath,
            style: {
              stroke: isOnCriticalPath ? '#ff9800' : '#666',
              strokeWidth: isOnCriticalPath ? 3 : 2,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isOnCriticalPath ? '#ff9800' : '#666',
              width: 20,
              height: 20,
            },
          });
        }
      });
    });

    console.log('DependencyGraphFlow - Created nodes:', nodes.length, 'edges:', edges.length);
    return { initialNodes: nodes, initialEdges: edges };
  }, [prs, dependencyGraph, criticalPath, filter]);

  // Apply layout
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    const result = getLayoutedElements(initialNodes, initialEdges, layoutDirection);
    console.log('DependencyGraphFlow - Layouted nodes:', result.nodes.length);
    if (result.nodes.length > 0) {
      console.log('First node position:', result.nodes[0].position);
    }
    return result;
  }, [initialNodes, initialEdges, layoutDirection]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Update nodes/edges when layout changes
  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Fit view when nodes change or component becomes visible
  useEffect(() => {
    if (nodes.length > 0 && !isCollapsed) {
      console.log('DependencyGraphFlow - Calling fitView with', nodes.length, 'nodes');
      // Delay fitView to ensure container is properly sized
      const timer = setTimeout(() => {
        console.log('DependencyGraphFlow - Executing fitView');
        try {
          reactFlowInstance.fitView({
            padding: 0.2,
            duration: 300,
            minZoom: 0.1,
            maxZoom: 1
          });
        } catch (error) {
          console.error('DependencyGraphFlow - fitView error:', error);
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, isCollapsed, reactFlowInstance]);

  const toggleLayout = useCallback(() => {
    setLayoutDirection((dir) => (dir === 'TB' ? 'LR' : 'TB'));
  }, []);

  if (!dependencyGraph || prs.length === 0) {
    return (
      <div className="dependency-graph-flow">
        <h2 onClick={() => setIsCollapsed(!isCollapsed)} className="collapsible-header">
          <span className={`chevron ${isCollapsed ? 'collapsed' : ''}`}>▼</span>
          Dependency Graph
        </h2>
        {!isCollapsed && (
          <div className="empty-state">No dependency data available</div>
        )}
      </div>
    );
  }

  return (
    <div className="dependency-graph-flow">
      <h2 onClick={() => setIsCollapsed(!isCollapsed)} className="collapsible-header">
        <span className={`chevron ${isCollapsed ? 'collapsed' : ''}`}>▼</span>
        Dependency Graph
      </h2>

      {!isCollapsed && (
        <div className="flow-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          attributionPosition="bottom-left"
          minZoom={0.1}
          maxZoom={2}
          fitView
          style={{ width: '100%', height: '100%' }}
        >
          <Background color="#333" gap={16} />
          <Controls />
          <MiniMap
            nodeColor={(node: Node) => {
              const style = node.style as any;
              return style?.background || '#2a2a2a';
            }}
            maskColor="rgba(0, 0, 0, 0.6)"
          />

          <Panel position="top-left" className="flow-controls">
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
                Root PRs
              </button>
              <button
                className={filter === 'critical' ? 'active' : ''}
                onClick={() => setFilter('critical')}
              >
                Critical Path ({criticalPath.length})
              </button>
            </div>

            <button className="layout-toggle" onClick={toggleLayout}>
              Layout: {layoutDirection === 'TB' ? 'Top → Bottom' : 'Left → Right'}
            </button>
          </Panel>

          <Panel position="top-right" className="flow-legend">
            <div className="legend-title">Legend</div>
            <div className="legend-items">
              <div className="legend-item">
                <div className="legend-box completed"></div>
                <span>Completed</span>
              </div>
              <div className="legend-item">
                <div className="legend-box in-progress"></div>
                <span>In Progress</span>
              </div>
              <div className="legend-item">
                <div className="legend-box broken"></div>
                <span>Broken</span>
              </div>
              <div className="legend-item">
                <div className="legend-box critical"></div>
                <span>Critical Path</span>
              </div>
            </div>
          </Panel>
        </ReactFlow>
        </div>
      )}
    </div>
  );
}

// Wrapper component that provides ReactFlowProvider context
export function DependencyGraphFlow(props: DependencyGraphFlowProps) {
  console.log('DependencyGraphFlow - Component rendering with:', {
    prsCount: props.prs?.length,
    hasGraph: !!props.dependencyGraph,
    criticalPathCount: props.criticalPath?.length
  });

  return (
    <ReactFlowProvider>
      <DependencyGraphFlowInner {...props} />
    </ReactFlowProvider>
  );
}
