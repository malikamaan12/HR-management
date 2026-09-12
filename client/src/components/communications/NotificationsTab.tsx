import type { ApiNotification, ApiNotificationPreferences } from '@/lib/api-types';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Bell, Plus, Check, X, ExternalLink, MailOpen, MessageSquare, Share, PhoneOutgoing, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const NotificationsTab = () => {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: notifications, isLoading } = useQuery<ApiNotification[]>({
    queryKey: ["/api/notifications"],
    enabled: true,
  });

  const { data: preferences, isLoading: preferencesLoading } = useQuery<ApiNotificationPreferences>({
    queryKey: ["/api/notifications/preferences"],
    enabled: true,
  });

  const handleSendNotification = () => {
    // Implementation will be added later
    setIsCreateDialogOpen(false);
    toast({
      title: "Feature in development",
      description: "This feature is currently being implemented.",
    });
  };

  const handleUpdatePreferences = (key: string, value: boolean) => {
    toast({
      title: "Feature in development",
      description: "This feature is currently being implemented.",
    });
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'email':
        return <MailOpen size={16} />;
      case 'sms':
        return <MessageSquare size={16} />;
      case 'push':
        return <Share size={16} />;
      case 'slack':
        return <ExternalLink size={16} />;
      default:
        return <Bell size={16} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'delivered':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'failed':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'pending':
        return 'text-orange-600 bg-orange-50 border-orange-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="list">
        <TabsList className="w-full max-w-md mb-6 grid grid-cols-2">
          <TabsTrigger value="list" className="flex items-center gap-2">
            <Bell size={16} />
            Notifications List
          </TabsTrigger>
          <TabsTrigger value="preferences" className="flex items-center gap-2">
            <PhoneOutgoing size={16} />
            Preferences
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">System Notifications</h2>
            
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus size={16} />
                  New Notification
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                  <DialogTitle>Send New Notification</DialogTitle>
                  <DialogDescription>
                    Create a new notification to send to users through the selected channels.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="message">Message</Label>
                    <Textarea
                      id="message"
                      placeholder="Enter notification message"
                      rows={4}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="recipient">Recipient</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select recipient type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Employees</SelectItem>
                        <SelectItem value="department">By Department</SelectItem>
                        <SelectItem value="individual">Individual User</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center space-x-2">
                      <Switch id="email-channel" />
                      <Label htmlFor="email-channel">Email</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch id="sms-channel" />
                      <Label htmlFor="sms-channel">SMS</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch id="push-channel" />
                      <Label htmlFor="push-channel">Push</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch id="slack-channel" />
                      <Label htmlFor="slack-channel">Slack</Label>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSendNotification} className="gap-2">
                    <Send size={16} />
                    Send Notification
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex justify-between mb-2">
                      <Skeleton className="h-5 w-1/3" />
                      <Skeleton className="h-5 w-24" />
                    </div>
                    <Skeleton className="h-12 w-full mb-2" />
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-1/4" />
                      <Skeleton className="h-6 w-20" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : notifications && notifications.length > 0 ? (
            <div className="space-y-3">
              {notifications.map((notification: any) => (
                <Card key={notification.id}>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        {getChannelIcon(notification.channel)}
                        <span className="font-medium capitalize">{notification.channel} Notification</span>
                      </div>
                      <Badge 
                        className={`capitalize ${getStatusColor(notification.status)}`}
                      >
                        {notification.status === 'delivered' && <Check size={12} className="mr-1" />}
                        {notification.status === 'failed' && <X size={12} className="mr-1" />}
                        {notification.status}
                      </Badge>
                    </div>
                    <p className="text-sm mb-3">{notification.message}</p>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>
                        {format(new Date(notification.timestamp), 'MMM d, yyyy h:mm a')}
                      </span>
                      <div className="flex items-center gap-1">
                        <span>Recipient:</span>
                        <span className="font-medium">{notification.user?.username || 'User'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-6">
                <Bell size={64} className="text-muted-foreground/30 mb-4" />
                <h3 className="text-xl font-semibold mb-2">No Notifications</h3>
                <p className="text-muted-foreground text-center mb-4">
                  There are currently no notifications in the system.
                </p>
                <Button 
                  onClick={() => setIsCreateDialogOpen(true)}
                  className="gap-2"
                >
                  <Plus size={16} />
                  Send First Notification
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="preferences" className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold mb-6">Notification Preferences</h2>
          
            <Card>
              <CardHeader>
                <CardTitle>Communication Channels</CardTitle>
                <CardDescription>
                  Choose how you would like to receive notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {preferencesLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="flex items-center justify-between">
                        <Skeleton className="h-5 w-1/3" />
                        <Skeleton className="h-6 w-12" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MailOpen className="h-5 w-5 text-muted-foreground" />
                          <Label htmlFor="email-enabled">Email Notifications</Label>
                        </div>
                        <Switch 
                          id="email-enabled" 
                          checked={preferences?.emailEnabled ?? false}
                          onCheckedChange={(value) => handleUpdatePreferences('emailEnabled', value)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-5 w-5 text-muted-foreground" />
                          <Label htmlFor="sms-enabled">SMS Notifications</Label>
                        </div>
                        <Switch 
                          id="sms-enabled" 
                          checked={preferences?.smsEnabled ?? false}
                          onCheckedChange={(value) => handleUpdatePreferences('smsEnabled', value)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Share className="h-5 w-5 text-muted-foreground" />
                          <Label htmlFor="push-enabled">Push Notifications</Label>
                        </div>
                        <Switch 
                          id="push-enabled" 
                          checked={preferences?.pushEnabled ?? false}
                          onCheckedChange={(value) => handleUpdatePreferences('pushEnabled', value)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ExternalLink className="h-5 w-5 text-muted-foreground" />
                          <Label htmlFor="slack-enabled">Slack Notifications</Label>
                        </div>
                        <Switch 
                          id="slack-enabled" 
                          checked={preferences?.slackEnabled ?? false}
                          onCheckedChange={(value) => handleUpdatePreferences('slackEnabled', value)}
                        />
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <CardTitle className="text-lg mb-4">Notification Types</CardTitle>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="announce-enabled">Announcements</Label>
                          <Switch 
                            id="announce-enabled" 
                            checked={preferences?.announcements ?? false}
                            onCheckedChange={(value) => handleUpdatePreferences('announcements', value)}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="leave-enabled">Leave Updates</Label>
                          <Switch 
                            id="leave-enabled" 
                            checked={preferences?.leaveUpdates ?? false}
                            onCheckedChange={(value) => handleUpdatePreferences('leaveUpdates', value)}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="doc-enabled">Document Expiry</Label>
                          <Switch 
                            id="doc-enabled" 
                            checked={preferences?.documentExpiry ?? false}
                            onCheckedChange={(value) => handleUpdatePreferences('documentExpiry', value)}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="event-enabled">Event Assignments</Label>
                          <Switch 
                            id="event-enabled" 
                            checked={preferences?.eventAssignments ?? false}
                            onCheckedChange={(value) => handleUpdatePreferences('eventAssignments', value)}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default NotificationsTab;