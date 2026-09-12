import type { ApiAnnouncement } from '@/lib/api-types';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Megaphone, Plus, Pin, PinOff, Edit, Trash2, PieChart } from "lucide-react";
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
import { format } from "date-fns";

const AnnouncementsTab = () => {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: announcements, isLoading, refetch } = useQuery<ApiAnnouncement[]>({
    queryKey: ["/api/announcements"],
    enabled: true,
  });

  const handleCreateAnnouncement = () => {
    // Implementation will be added later
    setIsCreateDialogOpen(false);
    toast({
      title: "Feature in development",
      description: "This feature is currently being implemented.",
    });
  };

  const handlePinAnnouncement = (id: number) => {
    toast({
      title: "Feature in development",
      description: "This feature is currently being implemented.",
    });
  };

  const handleEditAnnouncement = (id: number) => {
    toast({
      title: "Feature in development",
      description: "This feature is currently being implemented.",
    });
  };

  const handleDeleteAnnouncement = (id: number) => {
    toast({
      title: "Feature in development",
      description: "This feature is currently being implemented.",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Company Announcements</h2>
        
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus size={16} />
              New Announcement
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[525px]">
            <DialogHeader>
              <DialogTitle>Create New Announcement</DialogTitle>
              <DialogDescription>
                Create a new announcement to broadcast to employees.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  placeholder="Enter announcement title"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="content">Content</Label>
                <Textarea
                  id="content"
                  placeholder="Enter announcement content"
                  rows={5}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="target">Target Audience</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target audience" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Employees</SelectItem>
                    <SelectItem value="department">By Department</SelectItem>
                    <SelectItem value="role">By Role</SelectItem>
                    <SelectItem value="custom">Custom Selection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expiry">Expiry Date (Optional)</Label>
                <Input
                  id="expiry"
                  type="date"
                  placeholder="Set expiry date"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateAnnouncement}>
                Create Announcement
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-3/4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
                <div className="flex justify-between mt-4">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-8 w-1/4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : announcements && announcements.length > 0 ? (
        <div className="space-y-4">
          {announcements.map((announcement: any) => (
            <Card key={announcement.id}>
              <CardHeader className="pb-2 pt-6">
                <div className="flex justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Megaphone size={20} className="text-primary" />
                    {announcement.title}
                    {announcement.isPinned && (
                      <Badge variant="secondary" className="ml-2">Pinned</Badge>
                    )}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handlePinAnnouncement(announcement.id)}
                    >
                      {announcement.isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleEditAnnouncement(announcement.id)}
                    >
                      <Edit size={16} />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleDeleteAnnouncement(announcement.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-line">
                  {announcement.content}
                </p>
                <div className="flex justify-between mt-4">
                  <div className="text-xs text-muted-foreground">
                    <span>Posted by {announcement.author?.firstName} {announcement.author?.lastName}</span>
                    <span> • </span>
                    <span>{format(new Date(announcement.createdAt), 'MMM d, yyyy')}</span>
                    {announcement.expiryDate && (
                      <>
                        <span> • </span>
                        <span>Expires: {format(new Date(announcement.expiryDate), 'MMM d, yyyy')}</span>
                      </>
                    )}
                  </div>
                  <Badge 
                    variant={announcement.targetAudience === 'all' ? 'default' : 'outline'}
                  >
                    {announcement.targetAudience === 'all' ? 'All Employees' : 
                     announcement.targetAudience === 'department' ? `Dept: ${announcement.targetDepartment}` :
                     announcement.targetAudience === 'role' ? `Role: ${announcement.targetRole}` :
                     'Custom Group'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-6">
            <Megaphone size={64} className="text-muted-foreground/30 mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Announcements Yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              There are currently no announcements. Create a new announcement to inform your team.
            </p>
            <Button 
              onClick={() => setIsCreateDialogOpen(true)}
              className="gap-2"
            >
              <Plus size={16} />
              Create First Announcement
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AnnouncementsTab;