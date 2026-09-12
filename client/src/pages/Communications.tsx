import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { MessageSquarePlus, Bell, Megaphone, BellPlus, AlarmClock, AlertCircle, Check, RefreshCw, Brain } from "lucide-react";
import { SiSlack } from "@icons-pack/react-simple-icons";
import AnnouncementsTab from "@/components/communications/AnnouncementsTab";
import NotificationsTab from "@/components/communications/NotificationsTab";
import SlackIntegrationTab from "@/components/communications/SlackIntegrationTab";
import AnthropicTab from "@/components/communications/AnthropicTab";

const Communications = () => {
  const [activeTab, setActiveTab] = useState("announcements");
  const { toast } = useToast();

  const { data: slackStatus, isLoading: isSlackStatusLoading } = useQuery<{connected:boolean}>({
    queryKey: ["/api/slack/status"],
    enabled: true,
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value);
  };

  return (
    <div className="container mx-auto py-6 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Communication Hub</h1>
          <p className="text-muted-foreground mt-1">
            Manage announcements, notifications, and communication settings
          </p>
        </div>
        <div className="flex gap-4">
          {slackStatus?.connected ? (
            <div className="flex items-center gap-2 text-sm text-green-600 border border-green-200 bg-green-50 p-2 rounded-md">
              <SiSlack size={16} />
              <span>Slack Connected</span>
              <Check size={16} />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-orange-600 border border-orange-200 bg-orange-50 p-2 rounded-md">
              <SiSlack size={16} />
              <span>Slack Not Connected</span>
              <AlertCircle size={16} />
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="announcements" value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-8">
          <TabsTrigger value="announcements" className="flex items-center gap-2">
            <Megaphone size={16} />
            Announcements
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-2">
            <Bell size={16} />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="slack" className="flex items-center gap-2">
            <SiSlack size={16} />
            Slack Integration
          </TabsTrigger>
          <TabsTrigger value="anthropic" className="flex items-center gap-2">
            <Brain size={16} />
            AI Assistant
          </TabsTrigger>
        </TabsList>

        <TabsContent value="announcements" className="space-y-4">
          <AnnouncementsTab />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <NotificationsTab />
        </TabsContent>

        <TabsContent value="slack" className="space-y-4">
          <SlackIntegrationTab />
        </TabsContent>
        
        <TabsContent value="anthropic" className="space-y-4">
          <AnthropicTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Communications;