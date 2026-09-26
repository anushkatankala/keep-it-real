"use client";

export interface TabDefinition {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: readonly TabDefinition[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

/** Switches between labeled panels using a restrained underline treatment. */
export function TabBar({
  tabs,
  activeTab,
  onTabChange,
}: TabBarProps) {
  return (
    <div className="flex border-b border-white/[0.08]" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const handleTabChange = () => {
          onTabChange(tab.id);
        };

        return (
          <button
            key={tab.id}
            aria-selected={isActive}
            className={`border-b py-4 pr-8 text-sm font-light transition-colors duration-200 ${
              isActive
                ? "border-white text-white"
                : "border-transparent text-white/35 hover:text-white/65"
            }`}
            onClick={handleTabChange}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
