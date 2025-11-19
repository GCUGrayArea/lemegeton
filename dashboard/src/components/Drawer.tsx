import { useState } from 'react';
import { PRPanel } from './PRPanel';
import { ProgressPanel } from './ProgressPanel';
import { ActivityPanel, ActivityMessage } from './ActivityPanel';

export interface DrawerProps {
  state: any;
  phaseProgress: any;
  activityMessages: ActivityMessage[];
}

type TabType = 'prs' | 'progress' | 'activity';

export function Drawer({ state, phaseProgress, activityMessages }: DrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('prs');

  const toggleDrawer = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        className={`drawer-toggle ${isOpen ? 'open' : ''}`}
        onClick={toggleDrawer}
        aria-label={isOpen ? 'Close drawer' : 'Open drawer'}
      >
        <span className="drawer-toggle-icon">
          {isOpen ? '◀' : '▶'}
        </span>
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="drawer-backdrop"
          onClick={toggleDrawer}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div className={`drawer ${isOpen ? 'open' : ''}`}>
        {/* Tabs */}
        <div className="drawer-tabs">
          <button
            className={`drawer-tab ${activeTab === 'prs' ? 'active' : ''}`}
            onClick={() => setActiveTab('prs')}
          >
            Pull Requests
          </button>
          <button
            className={`drawer-tab ${activeTab === 'progress' ? 'active' : ''}`}
            onClick={() => setActiveTab('progress')}
          >
            Phase Progress
          </button>
          <button
            className={`drawer-tab ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            Activity Log
          </button>
        </div>

        {/* Tab Content */}
        <div className="drawer-content">
          {activeTab === 'prs' && (
            <div className="drawer-panel">
              <PRPanel state={state} />
            </div>
          )}
          {activeTab === 'progress' && (
            <div className="drawer-panel">
              <ProgressPanel phaseProgress={phaseProgress} />
            </div>
          )}
          {activeTab === 'activity' && (
            <div className="drawer-panel">
              <ActivityPanel messages={activityMessages} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
