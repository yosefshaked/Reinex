import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function DetailTabsShell({ header = null, activeTab, onTabChange, tabs = [] }) {
  const safeTabs = Array.isArray(tabs) ? tabs.filter((tab) => tab && tab.key) : [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {header}

      <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
        <div className="border-b border-border">
          <TabsList className="bg-transparent h-auto p-0 gap-1">
            {safeTabs.map((tab) => (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 data-[state=active]:shadow-none px-4 py-2.5 font-medium"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {safeTabs.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="space-y-4">
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
