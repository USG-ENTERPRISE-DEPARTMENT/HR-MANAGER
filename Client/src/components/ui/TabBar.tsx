import type { ReactNode } from 'react';

interface TabBarProps {
  tabs: string[];
  activeTab: string;
  onChange: (tab: string) => void;
  className?: string;
  /** Optional icon per tab label, rendered before the text. */
  icons?: Record<string, ReactNode>;
}

export function TabBar({ tabs, activeTab, onChange, className = 'flex flex-wrap items-center gap-2 mt-2 mb-4', icons }: TabBarProps) {
  return (
    <div className={className}>
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`tab-btn ${activeTab === tab ? 'active' : ''}${icons ? ' inline-flex items-center gap-1.5' : ''}`}
        >
          {icons?.[tab]}
          {tab}
        </button>
      ))}
    </div>
  );
}
