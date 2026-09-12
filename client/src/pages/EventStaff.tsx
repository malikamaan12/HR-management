import React, { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { formatDate, formatDateTime, getStatusClass } from "@/lib/utils";
import { Event, EventStaffAssignment, EventRole, Employee } from "@shared/schema";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface EventWithStaffCounts extends Event {
  staffNeeded: number;
  staffAssigned: number;
}

interface AssignmentWithNames extends EventStaffAssignment {
  eventName: string;
  employeeName: string;
  roleName: string;
}

export default function EventStaff() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("upcoming");
  const { toast } = useToast();
  
  // Fetch events
  const { data: eventsData = [], isLoading: eventsLoading, error: eventsError } = useQuery<Event[]>({
    queryKey: ['/api/events'],
    staleTime: 1000 * 60, // 1 minute
  });

  // Fetch event roles to get staff needed counts
  const { data: eventRoles = [] } = useQuery<EventRole[]>({
    queryKey: ['/api/event-roles'],
    staleTime: 1000 * 60,
  });

  // Fetch staff assignments
  const { data: assignmentsData = [], isLoading: assignmentsLoading, error: assignmentsError } = useQuery<EventStaffAssignment[]>({
    queryKey: ['/api/event-staff-assignments'],
    staleTime: 1000 * 60, // 1 minute
  });

  // Fetch employees for name lookup
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['/api/employees'],
    staleTime: 1000 * 60,
  });

  // Process event data to include staff counts using useMemo to prevent infinite loops
  const events = useMemo<EventWithStaffCounts[]>(() => {
    if (eventsData.length === 0) return [];
    
    return eventsData.map(event => {
      // Get roles for this event
      const rolesForEvent = eventRoles.filter(role => role.eventId === event.id);
      
      // Calculate total staff needed from all roles
      const staffNeeded = rolesForEvent.reduce((sum, role) => sum + (role.numberOfStaff || 0), 0);
      
      // Count assignments for this event
      const staffAssigned = assignmentsData.filter(assignment => assignment.eventId === event.id).length;
      
      return {
        ...event,
        staffNeeded,
        staffAssigned
      };
    });
  }, [eventsData, eventRoles, assignmentsData]);

  // Process assignment data to include names using useMemo
  const assignments = useMemo<AssignmentWithNames[]>(() => {
    if (assignmentsData.length === 0 || eventsData.length === 0 || eventRoles.length === 0 || employees.length === 0) {
      return [];
    }
    
    return assignmentsData.map(assignment => {
      // Find related event
      const event = eventsData.find(e => e.id === assignment.eventId);
      
      // Find related role - using role field instead of roleId
      const role = eventRoles.find(r => r.roleName === assignment.role);
      
      // Find related employee
      const employee = employees.find(e => e.id === assignment.employeeId);
      
      return {
        ...assignment,
        eventName: event?.name || 'Unknown Event',
        employeeName: employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown Employee',
        roleName: role?.roleName || 'Unknown Role'
      };
    });
  }, [assignmentsData, eventsData, eventRoles, employees]);
  
  // Filter events based on active tab and search query
  const filteredEvents = events.filter(event => {
    const matchesSearch = 
      event.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.location?.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (activeTab === "all") return matchesSearch;
    return event.status === activeTab && matchesSearch;
  });

  // State for event detail view
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [isViewingEventDetails, setIsViewingEventDetails] = useState(false);

  // Import components
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Lazy load components
  const CreateEventModal = React.lazy(() => import('@/components/events/CreateEventModal'));
  const EventRoleManager = React.lazy(() => import('@/components/events/EventRoleManager'));
  const EventStaffRoster = React.lazy(() => import('@/components/events/EventStaffRoster'));

  return (
    <div className="space-y-6">
      {/* Header with Create Event Button */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Event Staff Management</h1>
          <p className="text-gray-600">Manage events, roles, and staff assignments</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          Create New Event
        </Button>
      </div>

      {/* Create Event Modal */}
      <React.Suspense fallback={null}>
        <CreateEventModal 
          open={showCreateModal} 
          onOpenChange={setShowCreateModal}
        />
      </React.Suspense>

      {/* Event Details View */}
      {isViewingEventDetails && selectedEventId ? (
        <div className="space-y-6">
          <div className="flex items-center space-x-4">
            <Button variant="outline" onClick={() => {
              setIsViewingEventDetails(false);
              setSelectedEventId(null);
            }}>
              ← Back to Events
            </Button>
            <h2 className="text-2xl font-semibold">
              {events.find(e => e.id === selectedEventId)?.name || "Event Details"}
            </h2>
          </div>

          <React.Suspense fallback={<div className="py-8 text-center">Loading event details...</div>}>
            <div className="grid grid-cols-1 gap-6">
              <EventRoleManager eventId={selectedEventId} />
              <EventStaffRoster eventId={selectedEventId} />
            </div>
          </React.Suspense>
        </div>
      ) : (
        // Events list view
        <>
          <Card>
            <CardHeader>
              <div className="flex gap-4 items-center">
                <Input
                  placeholder="Search events..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="max-w-md"
                />
              </div>
            </CardHeader>
            <CardContent>
              
              <Tabs defaultValue="upcoming" onValueChange={setActiveTab}>
                <TabsList className="mb-4">
                  <TabsTrigger value="upcoming">Upcoming Events</TabsTrigger>
                  <TabsTrigger value="ongoing">Ongoing</TabsTrigger>
                  <TabsTrigger value="completed">Completed</TabsTrigger>
                  <TabsTrigger value="all">All Events</TabsTrigger>
                </TabsList>
                
                <TabsContent value={activeTab} className="mt-0">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-neutral-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Event Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Date</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Location</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-neutral-500 uppercase tracking-wider">Staff Needed</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-neutral-500 uppercase tracking-wider">Staff Assigned</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-neutral-200">
                        {eventsLoading ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-3 text-sm text-center text-neutral-500">Loading events...</td>
                          </tr>
                        ) : eventsError ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-3 text-sm text-center text-error">Error loading events</td>
                          </tr>
                        ) : filteredEvents.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-3 text-sm text-center text-neutral-500">No events found</td>
                          </tr>
                        ) : (
                          filteredEvents.map((event) => (
                            <tr key={event.id}>
                              <td className="px-4 py-3 text-sm font-medium text-neutral-800">
                                {event.name}
                              </td>
                              <td className="px-4 py-3 text-sm text-neutral-800">
                                {formatDate(event.startDate)} {event.startDate !== event.endDate && event.endDate && `- ${formatDate(event.endDate)}`}
                              </td>
                              <td className="px-4 py-3 text-sm text-neutral-800">
                                {event.location}
                              </td>
                              <td className="px-4 py-3 text-sm text-neutral-800 text-center">
                                {event.staffNeeded || 0}
                              </td>
                              <td className="px-4 py-3 text-sm text-center">
                                <span className={`${
                                  event.staffAssigned === event.staffNeeded 
                                    ? "bg-success/10 text-success" 
                                    : event.staffAssigned >= event.staffNeeded * 0.8 
                                    ? "bg-warning/10 text-warning" 
                                    : "bg-error/10 text-error"
                                } px-2 py-1 rounded-full text-xs font-medium`}>
                                  {event.staffAssigned || 0} / {event.staffNeeded || 0}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusClass(event.status)}`}>
                                  {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-right space-x-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedEventId(event.id);
                                    setIsViewingEventDetails(true);
                                  }}
                                  title="Manage staff"
                                >
                                  Manage Staff
                                </Button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-poppins font-semibold">Recent Staff Assignments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-200">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Event</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Employee</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Role</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Time</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-neutral-200">
                    {assignmentsLoading ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 text-sm text-center text-neutral-500">Loading assignments...</td>
                      </tr>
                    ) : assignmentsError ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 text-sm text-center text-error">Error loading assignments</td>
                      </tr>
                    ) : assignments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 text-sm text-center text-neutral-500">No staff assignments found</td>
                      </tr>
                    ) : (
                      assignments.map((assignment) => (
                        <tr key={assignment.id}>
                          <td className="px-4 py-3 text-sm font-medium text-neutral-800">
                            {assignment.eventName}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-800">
                            {assignment.employeeName}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-800">
                            {assignment.roleName}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-800">
                            {formatDateTime(assignment.startTime)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusClass(assignment.status)}`}>
                              {assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1).replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-right space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Send notification"
                            >
                              <i className="fas fa-envelope"></i>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Edit assignment"
                            >
                              <i className="fas fa-edit"></i>
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
