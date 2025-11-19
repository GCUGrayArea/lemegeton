import React, { useState, useEffect } from 'react';
import { PRPanel } from './PRPanel';
import { ProgressPanel } from './ProgressPanel';
import { ActivityPanel, ActivityMessage } from './ActivityPanel';
import { PhaseProgress } from '../utils/dependencyAnalysis';
import './Drawer.css';

interface DrawerProps {
  state: any;
  phaseProgress: PhaseProgress[];
  activityMessages: ActivityMessage[];
}

type TabType = 'prs' | 'progress' | 'activity';

const Drawer: React.FC<DrawerProps> = ({ state, phaseProgress, activityMessages }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('prs');

  useEffect(() => {
    // Add/remove class to body to adjust main content layout
    if (isOpen) {
      document.body.classList.add('drawer-open');
      document.body.classList.remove('drawer-closed');
    } else {
      document.body.classList.add('drawer-closed');
      document.body.classList.remove('drawer-open');
    }
  }, [isOpen]);

  const toggleDrawer = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      <div className={`drawer ${isOpen ? 'drawer-open' : 'drawer-closed'}`}>
        {isOpen && (
          <>
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
            <div className="drawer-content">
              {activeTab === 'prs' && <PRPanel state={state} />}
              {activeTab === 'progress' && <ProgressPanel phaseProgress={phaseProgress} />}
              {activeTab === 'activity' && <ActivityPanel messages={activityMessages} />}
            </div>
          </>
        )}
      </div>
      <button className="drawer-toggle" onClick={toggleDrawer}>
        {isOpen ? '◀' : '▶'}
      </button>
    </>
  );
};

export default Drawer;
