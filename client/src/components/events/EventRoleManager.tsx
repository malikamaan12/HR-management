import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, EditIcon, TrashIcon, UsersIcon, BriefcaseIcon } from "lucide-react";
import { EventRole } from "@shared/schema";

interface EventRoleManagerProps {
  eventId: number;
  onRolesUpdate?: () => void;
}

export default function EventRoleManager({ eventId, onRolesUpdate }: EventRoleManagerProps) {
  const { toast } = useToast();
  const [isAddingRole, setIsAddingRole] = useState(false);
  const [editingRole, setEditingRole] = useState<EventRole | null>(null);
  
  const [formData, setFormData] = useState({
    roleName: "",
    description: "",
    numberOfStaff: "",
    hourlyRate: "",
    responsibilities: ""
  });

  // Fetch event roles
  const { data: roles = [], isLoading, refetch } = useQuery<EventRole[]>({
    queryKey: [`/api/event-roles?eventId=${eventId}`],
    staleTime: 1000 * 60
  });

  const handleSubmit = async () => {
    try {
      if (!formData.roleName || !formData.numberOfStaff || !formData.hourlyRate) {
        toast({
          title: "Validation Error",
          description: "Role name, number of staff, and hourly rate are required",
          variant: "destructive"
        });
        return;
      }

      const roleData = {
        eventId,
        roleName: formData.roleName,
        roleDescription: formData.description || null,
        numberOfStaff: parseInt(formData.numberOfStaff),
        hourlyRate: formData.hourlyRate
      };

      if (editingRole) {
        await apiRequest({
          url: `/api/event-roles/${editingRole.id}`,
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roleData)
        });
        
        toast({
          title: "Success",
          description: "Role updated successfully"
        });
      } else {
        await apiRequest({
          url: "/api/event-roles",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roleData)
        });
        
        toast({
          title: "Success",
          description: "Role created successfully"
        });
      }

      // Reset form
      setFormData({
        roleName: "",
        description: "",
        numberOfStaff: "",
        hourlyRate: "",
        responsibilities: ""
      });
      setIsAddingRole(false);
      setEditingRole(null);
      
      // Refresh data
      refetch();
      if (onRolesUpdate) onRolesUpdate();
      queryClient.invalidateQueries({ queryKey: ['/api/event-roles'] });
      
    } catch (error) {
      console.error("Error saving role:", error);
      toast({
        title: "Error",
        description: "Failed to save role. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleEdit = (role: EventRole) => {
    setEditingRole(role);
    setFormData({
      roleName: role.roleName,
      description: role.roleDescription || "",
      numberOfStaff: role.numberOfStaff?.toString() || "",
      hourlyRate: role.hourlyRate?.toString() || "",
      responsibilities: ""
    });
    setIsAddingRole(true);
  };

  const handleDelete = async (roleId: number) => {
    if (!confirm("Are you sure you want to delete this role?")) return;
    
    try {
      await apiRequest({
        url: `/api/event-roles/${roleId}`,
        method: "DELETE"
      });
      
      toast({
        title: "Success",
        description: "Role deleted successfully"
      });
      
      refetch();
      if (onRolesUpdate) onRolesUpdate();
      
    } catch (error) {
      console.error("Error deleting role:", error);
      toast({
        title: "Error",
        description: "Failed to delete role. Please try again.",
        variant: "destructive"
      });
    }
  };

  const totalStaffNeeded = roles.reduce((sum, role) => sum + (role.numberOfStaff || 0), 0);
  const totalCost = roles.reduce((sum, role) => sum + ((role.numberOfStaff || 0) * (parseFloat(role.hourlyRate?.toString() || '0') || 0)), 0);

  if (isLoading) {
    return <div>Loading roles...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <BriefcaseIcon className="h-5 w-5" />
            Event Roles & Requirements
          </CardTitle>
          <Button
            size="sm"
            onClick={() => {
              setIsAddingRole(true);
              setEditingRole(null);
              setFormData({
                roleName: "",
                description: "",
                numberOfStaff: "",
                hourlyRate: "",
                responsibilities: ""
              });
            }}
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            Add Role
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 p-3 rounded-lg">
            <p className="text-sm text-gray-600">Total Roles</p>
            <p className="text-2xl font-bold text-blue-600">{roles.length}</p>
          </div>
          <div className="bg-green-50 p-3 rounded-lg">
            <p className="text-sm text-gray-600">Staff Needed</p>
            <p className="text-2xl font-bold text-green-600">{totalStaffNeeded}</p>
          </div>
          <div className="bg-purple-50 p-3 rounded-lg">
            <p className="text-sm text-gray-600">Est. Hourly Cost</p>
            <p className="text-2xl font-bold text-purple-600">QAR {totalCost.toFixed(2)}</p>
          </div>
        </div>

        {/* Add/Edit Role Form */}
        {isAddingRole && (
          <div className="border rounded-lg p-4 mb-4 bg-gray-50">
            <h3 className="font-semibold mb-3">
              {editingRole ? "Edit Role" : "Add New Role"}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="roleName">Role Name *</Label>
                <Input
                  id="roleName"
                  value={formData.roleName}
                  onChange={(e) => setFormData({ ...formData, roleName: e.target.value })}
                  placeholder="e.g., Event Coordinator"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="numberOfStaff">Staff Needed *</Label>
                  <Input
                    id="numberOfStaff"
                    type="number"
                    value={formData.numberOfStaff}
                    onChange={(e) => setFormData({ ...formData, numberOfStaff: e.target.value })}
                    placeholder="5"
                    min="1"
                  />
                </div>
                <div>
                  <Label htmlFor="hourlyRate">Hourly Rate (QAR) *</Label>
                  <Input
                    id="hourlyRate"
                    type="number"
                    value={formData.hourlyRate}
                    onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
                    placeholder="50"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>
            </div>
            
            <div className="mt-3">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief role description"
              />
            </div>
            
            <div className="mt-3">
              <Label htmlFor="responsibilities">Key Responsibilities</Label>
              <Textarea
                id="responsibilities"
                value={formData.responsibilities}
                onChange={(e) => setFormData({ ...formData, responsibilities: e.target.value })}
                placeholder="List main responsibilities..."
                rows={3}
              />
            </div>
            
            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsAddingRole(false);
                  setEditingRole(null);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSubmit}>
                {editingRole ? "Update Role" : "Add Role"}
              </Button>
            </div>
          </div>
        )}

        {/* Roles List */}
        <div className="space-y-2">
          {roles.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              No roles defined yet. Click "Add Role" to get started.
            </p>
          ) : (
            roles.map((role) => (
              <div key={role.id} className="border rounded-lg p-4 hover:bg-gray-50">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{role.roleName}</h4>
                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">
                        {role.numberOfStaff} Staff
                      </span>
                      {role.hourlyRate && (
                        <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs">
                          QAR {role.hourlyRate}/hr
                        </span>
                      )}
                    </div>
                    {role.roleDescription && (
                      <p className="text-sm text-gray-600 mt-1">{role.roleDescription}</p>
                    )}
                    {role.uniformRequirements && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-gray-500">Uniform Requirements:</p>
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{role.uniformRequirements}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(role)}
                    >
                      <EditIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(role.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}