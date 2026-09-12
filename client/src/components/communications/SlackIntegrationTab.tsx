import type { SlackStatus, SlackUserIntegration } from '@/lib/api-types';
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Check, X, LinkIcon, Send, BadgeAlert } from "lucide-react";
import { SiSlack } from "@icons-pack/react-simple-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { apiRequest, queryClient } from "@/lib/queryClient";

const SlackIntegrationTab = () => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [isTestMessageDialogOpen, setIsTestMessageDialogOpen] = useState(false);

  // Get Slack connection status
  const { data: slackStatus, isLoading: isStatusLoading, refetch: refetchStatus } = useQuery<SlackStatus>({
    queryKey: ["/api/slack/status"],
    enabled: true,
  });

  // Get user's Slack integration
  const { data: userIntegration, isLoading: isIntegrationLoading, refetch: refetchIntegration } = useQuery<SlackUserIntegration>({
    queryKey: ["/api/slack/user-integration"],
    enabled: true,
  });

  // Connect user to Slack mutation
  const connectUserMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest({
        url: "/api/slack/connect-user",
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Successfully connected to Slack",
        description: "Your account has been linked with Slack.",
      });
      setIsConnectDialogOpen(false);
      refetchIntegration();
    },
    onError: (error: any) => {
      toast({
        title: "Error connecting to Slack",
        description: error.message || "Failed to connect your account with Slack.",
        variant: "destructive",
      });
    },
  });

  // Send test message mutation
  const sendTestMessageMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest({
        url: "/api/slack/test-message",
        method: "POST",
        body: JSON.stringify({ message: testMessage }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Test message sent",
        description: "Your test message has been sent to Slack successfully.",
      });
      setIsTestMessageDialogOpen(false);
      setTestMessage("");
    },
    onError: (error: any) => {
      toast({
        title: "Error sending message",
        description: error.message || "Failed to send test message to Slack.",
        variant: "destructive",
      });
    },
  });

  const handleConnect = () => {
    if (!email) {
      toast({
        title: "Email required",
        description: "Please enter your Slack email address.",
        variant: "destructive",
      });
      return;
    }
    connectUserMutation.mutate();
  };

  const handleSendTestMessage = () => {
    if (!testMessage) {
      toast({
        title: "Message required",
        description: "Please enter a message to send.",
        variant: "destructive",
      });
      return;
    }
    sendTestMessageMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Slack Integration</h2>
        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2"
          onClick={() => {
            refetchStatus();
            refetchIntegration();
          }}
        >
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>

      {/* Slack Connection Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SiSlack size={22} />
            Slack Connection Status
          </CardTitle>
          <CardDescription>
            Check the current status of your Slack integration
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isStatusLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className={`px-4 py-2 rounded-md flex items-center gap-2 ${slackStatus?.connected ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
                  {slackStatus?.connected ? (
                    <>
                      <Check size={18} />
                      <span>Connected to Slack API</span>
                    </>
                  ) : (
                    <>
                      <X size={18} />
                      <span>Not connected to Slack API</span>
                    </>
                  )}
                </div>
                
                {slackStatus?.connected ? (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Bot Token: Valid
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    Bot Token: Missing
                  </Badge>
                )}
                
                {slackStatus?.channelId ? (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Channel ID: Valid
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    Channel ID: Missing
                  </Badge>
                )}
              </div>
              
              {!slackStatus?.connected && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-md">
                  <div className="flex items-start gap-2">
                    <BadgeAlert className="text-amber-600 mt-0.5" size={18} />
                    <div>
                      <p className="font-medium text-amber-800">Slack API not connected</p>
                      <p className="text-sm text-amber-700 mt-1">
                        Contact your system administrator to set up the Slack integration. This requires a valid Slack Bot Token and Channel ID.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Integration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon size={22} />
            User-Slack Connection
          </CardTitle>
          <CardDescription>
            Link your account with Slack for personal notifications
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isIntegrationLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-8 w-40 mx-auto" />
            </div>
          ) : userIntegration?.integrated ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 border-2 border-primary/10">
                  <AvatarFallback className="bg-primary/5 text-primary">
                    {userIntegration.slackUsername?.substring(0, 2).toUpperCase() || 'SU'}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-lg font-medium">{userIntegration.slackUsername}</h3>
                  <p className="text-sm text-muted-foreground">{userIntegration.slackEmail}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge 
                      variant={userIntegration.isActive ? "default" : "outline"}
                      className={userIntegration.isActive ? "bg-green-500" : ""}
                    >
                      {userIntegration.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {userIntegration.lastSynced && (
                      <span className="text-xs text-muted-foreground">
                        Last synced: {new Date(userIntegration.lastSynced).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <Dialog open={isTestMessageDialogOpen} onOpenChange={setIsTestMessageDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    Test Message
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send Test Message to Slack</DialogTitle>
                    <DialogDescription>
                      This will send a test message to your configured Slack channel.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Label htmlFor="test-message" className="mb-2 block">Message</Label>
                    <Textarea
                      id="test-message"
                      placeholder="Enter your test message here"
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      rows={4}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsTestMessageDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleSendTestMessage}
                      disabled={sendTestMessageMutation.isPending || !testMessage}
                      className="gap-2"
                    >
                      {sendTestMessageMutation.isPending ? (
                        <>
                          <RefreshCw size={16} className="animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send size={16} />
                          Send Message
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center p-6">
              <SiSlack size={48} className="text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">Not Connected to Slack</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                Connect your account with Slack to receive notifications directly in your workspace.
              </p>
              
              <Dialog open={isConnectDialogOpen} onOpenChange={setIsConnectDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2" disabled={!slackStatus?.connected}>
                    <SiSlack size={16} />
                    Connect with Slack
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Connect with Slack</DialogTitle>
                    <DialogDescription>
                      Enter your Slack email address to connect your E3 HR account with Slack.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Label htmlFor="slack-email" className="mb-2 block">Slack Email Address</Label>
                    <Input
                      id="slack-email"
                      type="email"
                      placeholder="your.email@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      This should be the email address associated with your Slack account.
                    </p>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsConnectDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleConnect}
                      disabled={connectUserMutation.isPending || !email}
                      className="gap-2"
                    >
                      {connectUserMutation.isPending ? (
                        <>
                          <RefreshCw size={16} className="animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <SiSlack size={16} />
                          Connect
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SlackIntegrationTab;